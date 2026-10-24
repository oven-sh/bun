'use strict'

const eos = require('node:stream').finished
const Readable = require('node:stream').Readable

const {
  kFourOhFourContext,
  kReplyErrorHandlerCalled,
  kReplyHijacked,
  kReplyStartTime,
  kReplyEndTime,
  kReplySerializer,
  kReplySerializerDefault,
  kReplyIsError,
  kReplyHeaders,
  kReplyTrailers,
  kReplyHasStatusCode,
  kReplyIsRunningOnErrorHook,
  kReplyNextErrorHandler,
  kDisableRequestLogging,
  kSchemaResponse,
  kReplyCacheSerializeFns,
  kSchemaController,
  kOptions,
  kRouteContext
}: typeof FS = require('./symbols.js')
const {
  onSendHookRunner,
  onResponseHookRunner,
  preHandlerHookRunner,
  preSerializationHookRunner
} = require('./hooks')

const internals = require('./handleRequest')[Symbol.for('internals')]
const loggerUtils = require('./logger-factory')
const now = loggerUtils.now
const { handleError } = require('./error-handler')
const { getSchemaSerializer } = require('./schemas')

const CONTENT_TYPE = {
  JSON: 'application/json; charset=utf-8',
  PLAIN: 'text/plain; charset=utf-8',
  OCTET: 'application/octet-stream'
}
const {
  FST_ERR_REP_INVALID_PAYLOAD_TYPE,
  FST_ERR_REP_RESPONSE_BODY_CONSUMED,
  FST_ERR_REP_READABLE_STREAM_LOCKED,
  FST_ERR_REP_ALREADY_SENT,
  FST_ERR_SEND_INSIDE_ONERR,
  FST_ERR_BAD_STATUS_CODE,
  FST_ERR_BAD_TRAILER_NAME,
  FST_ERR_BAD_TRAILER_VALUE,
  FST_ERR_MISSING_SERIALIZATION_FN,
  FST_ERR_MISSING_CONTENTTYPE_SERIALIZATION_FN
} = require('./errors')

const toString = Object.prototype.toString

function Reply (this: FY.Reply, res: FY.Outgoing, request: FY.Request, log: any) {
  this.raw = res
  this[kReplySerializer] = null
  this[kReplyErrorHandlerCalled] = false
  this[kReplyIsError] = false
  this[kReplyIsRunningOnErrorHook] = false
  this.request = request
  this[kReplyHeaders] = {}
  this[kReplyTrailers] = null
  this[kReplyHasStatusCode] = false
  this[kReplyStartTime] = undefined
  this.log = log
}
Reply.props = [] as FY.Decoration[]

Object.defineProperties(Reply.prototype, {
  [kRouteContext]: {
    get () {
      return this.request[kRouteContext]
    }
  },
  elapsedTime: {
    get () {
      if (this[kReplyStartTime] === undefined) {
        return 0
      }
      return (this[kReplyEndTime] || now()) - this[kReplyStartTime]
    }
  },
  server: {
    get () {
      return this.request[kRouteContext].server
    }
  },
  sent: {
    enumerable: true,
    get () {
      // We are checking whether reply was hijacked or the response has ended.
      return (this[kReplyHijacked] || this.raw.writableEnded) === true
    }
  },
  statusCode: {
    get () {
      return this.raw.statusCode
    },
    set (value) {
      this.code(value)
    }
  },
  routeOptions: {
    get () {
      return this.request.routeOptions
    }
  }
})

Reply.prototype.writeEarlyHints = function (this: FY.Reply, hints: any, callback: any) {
  this.raw.writeEarlyHints(hints, callback)
  return this
}

Reply.prototype.hijack = function (this: FY.Reply) {
  this[kReplyHijacked] = true
  return this
}

Reply.prototype.send = function (this: FY.Reply, payload: any) {
  if (this[kReplyIsRunningOnErrorHook] === true) {
    throw new FST_ERR_SEND_INSIDE_ONERR()
  }

  if (this.sent) {
    this.log.warn({ err: new FST_ERR_REP_ALREADY_SENT(this.request.url, this.request.method) })
    return this
  }

  if (payload instanceof Error || this[kReplyIsError] === true) {
    this[kReplyIsError] = false
    onErrorHook(this, payload, onSendHook)
    return this
  }

  if (payload === undefined) {
    onSendHook(this, payload)
    return this
  }

  const contentType = this.getHeader('content-type')
  const hasContentType = contentType !== undefined

  if (payload !== null) {
    if (
      // node:stream
      typeof payload.pipe === 'function' ||
      // node:stream/web
      typeof payload.getReader === 'function' ||
      // Response
      toString.call(payload) === '[object Response]'
    ) {
      onSendHook(this, payload)
      return this
    }

    if (payload?.buffer instanceof ArrayBuffer) {
      if (hasContentType === false) {
        this[kReplyHeaders]['content-type'] = CONTENT_TYPE.OCTET
      }
      const payloadToSend = Buffer.isBuffer(payload) ? payload : Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
      onSendHook(this, payloadToSend)
      return this
    }

    if (hasContentType === false && typeof payload === 'string') {
      this[kReplyHeaders]['content-type'] = CONTENT_TYPE.PLAIN
      onSendHook(this, payload)
      return this
    }
  }

  if (this[kReplySerializer] !== null) {
    if (typeof payload !== 'string') {
      preSerializationHook(this, payload)
      return this
    } else {
      payload = this[kReplySerializer](payload)
    }

    // The indexOf below also matches custom json mimetypes such as 'application/hal+json' or 'application/ld+json'
  } else if (hasContentType === false || contentType.indexOf('json') > -1) {
    if (hasContentType === false) {
      this[kReplyHeaders]['content-type'] = CONTENT_TYPE.JSON
    } else {
      // If user doesn't set charset, we will set charset to utf-8
      if (contentType.indexOf('charset') === -1) {
        const customContentType = contentType.trim()
        if (customContentType.endsWith(';')) {
          // custom content-type is ended with ';'
          this[kReplyHeaders]['content-type'] = `${customContentType} charset=utf-8`
        } else {
          this[kReplyHeaders]['content-type'] = `${customContentType}; charset=utf-8`
        }
      }
    }
    if (typeof payload !== 'string') {
      preSerializationHook(this, payload)
      return this
    }
  }

  onSendHook(this, payload)

  return this
}

Reply.prototype.getHeader = function (this: FY.Reply, key: any) {
  key = key.toLowerCase()
  const res = this.raw
  let value = this[kReplyHeaders][key]
  if (value === undefined && res.hasHeader(key)) {
    value = res.getHeader(key)
  }
  return value
}

Reply.prototype.getHeaders = function (this: FY.Reply) {
  return {
    ...this.raw.getHeaders(),
    ...this[kReplyHeaders]
  }
}

Reply.prototype.hasHeader = function (this: FY.Reply, key: any) {
  key = key.toLowerCase()

  return this[kReplyHeaders][key] !== undefined || this.raw.hasHeader(key)
}

Reply.prototype.removeHeader = function (this: FY.Reply, key: any) {
  // Node.js does not like headers with keys set to undefined,
  // so we have to delete the key.
  delete this[kReplyHeaders][key.toLowerCase()]
  return this
}

Reply.prototype.header = function (this: FY.Reply, key: any, value = '') {
  key = key.toLowerCase()

  if (this[kReplyHeaders][key] && key === 'set-cookie') {
    // https://datatracker.ietf.org/doc/html/rfc7230#section-3.2.2
    if (typeof this[kReplyHeaders][key] === 'string') {
      this[kReplyHeaders][key] = [this[kReplyHeaders][key]]
    }

    if (Array.isArray(value)) {
      Array.prototype.push.apply(this[kReplyHeaders][key], value)
    } else {
      this[kReplyHeaders][key].push(value)
    }
  } else {
    this[kReplyHeaders][key] = value
  }

  return this
}

Reply.prototype.headers = function (this: FY.Reply, headers: any) {
  const keys = Object.keys(headers)
  for (let i = 0; i !== keys.length; ++i) {
    const key = keys[i]!
    this.header(key, headers[key])
  }

  return this
}

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Trailer#directives
// https://datatracker.ietf.org/doc/html/rfc7230.html#chunked.trailer.part
const INVALID_TRAILERS = new Set([
  'transfer-encoding',
  'content-length',
  'host',
  'cache-control',
  'max-forwards',
  'te',
  'authorization',
  'set-cookie',
  'content-encoding',
  'content-type',
  'content-range',
  'trailer'
])

Reply.prototype.trailer = function (this: FY.Reply, key: any, fn: any) {
  key = key.toLowerCase()
  if (INVALID_TRAILERS.has(key)) {
    throw new FST_ERR_BAD_TRAILER_NAME(key)
  }
  if (typeof fn !== 'function') {
    throw new FST_ERR_BAD_TRAILER_VALUE(key, typeof fn)
  }
  if (this[kReplyTrailers] === null) this[kReplyTrailers] = {}
  this[kReplyTrailers][key] = fn
  return this
}

Reply.prototype.hasTrailer = function (this: FY.Reply, key: any) {
  return this[kReplyTrailers]?.[key.toLowerCase()] !== undefined
}

Reply.prototype.removeTrailer = function (this: FY.Reply, key: any) {
  if (this[kReplyTrailers] === null) return this
  this[kReplyTrailers]![key.toLowerCase()] = undefined as unknown as Function
  return this
}

Reply.prototype.code = function (this: FY.Reply, code: any) {
  const intValue = Number(code)
  if (isNaN(intValue) || intValue < 100 || intValue > 599) {
    throw new FST_ERR_BAD_STATUS_CODE(code || String(code))
  }

  this.raw.statusCode = intValue
  this[kReplyHasStatusCode] = true
  return this
}

Reply.prototype.status = Reply.prototype.code

Reply.prototype.getSerializationFunction = function (this: FY.Reply, schemaOrStatus: any, contentType: any) {
  let serialize

  if (typeof schemaOrStatus === 'string' || typeof schemaOrStatus === 'number') {
    if (typeof contentType === 'string') {
      serialize = this[kRouteContext][kSchemaResponse]?.[schemaOrStatus]?.[contentType]
    } else {
      serialize = this[kRouteContext][kSchemaResponse]?.[schemaOrStatus]
    }
  } else if (typeof schemaOrStatus === 'object') {
    serialize = this[kRouteContext][kReplyCacheSerializeFns]?.get(schemaOrStatus)
  }

  return serialize
}

Reply.prototype.compileSerializationSchema = function (this: FY.Reply, schema: any, httpStatus = null, contentType = null) {
  const { request } = this
  const { method, url } = request

  // Check if serialize function already compiled
  if (this[kRouteContext][kReplyCacheSerializeFns]?.has(schema)) {
    return this[kRouteContext][kReplyCacheSerializeFns].get(schema)
  }

  const serializerCompiler = this[kRouteContext].serializerCompiler ||
    this.server[kSchemaController].serializerCompiler ||
    (
      // We compile the schemas if no custom serializerCompiler is provided
      // nor set
      this.server[kSchemaController].setupSerializer(this.server[kOptions]) ||
      this.server[kSchemaController].serializerCompiler
    )

  const serializeFn = serializerCompiler({
    schema,
    method,
    url,
    httpStatus,
    contentType
  })

  // We create a WeakMap to compile the schema only once
  // Its done lazily to avoid add overhead by creating the WeakMap
  // if it is not used
  // TODO: Explore a central cache for all the schemas shared across
  // encapsulated contexts
  if (this[kRouteContext][kReplyCacheSerializeFns] == null) {
    this[kRouteContext][kReplyCacheSerializeFns] = new WeakMap()
  }

  this[kRouteContext][kReplyCacheSerializeFns].set(schema, serializeFn)

  return serializeFn
}

Reply.prototype.serializeInput = function (this: FY.Reply, input: any, schema: any, httpStatus: any, contentType: any) {
  const possibleContentType = httpStatus
  let serialize
  httpStatus = typeof schema === 'string' || typeof schema === 'number'
    ? schema
    : httpStatus

  contentType = httpStatus && possibleContentType !== httpStatus
    ? possibleContentType
    : contentType

  if (httpStatus != null) {
    if (contentType != null) {
      serialize = this[kRouteContext][kSchemaResponse]?.[httpStatus]?.[contentType]
    } else {
      serialize = this[kRouteContext][kSchemaResponse]?.[httpStatus]
    }

    if (serialize == null) {
      if (contentType) throw new FST_ERR_MISSING_CONTENTTYPE_SERIALIZATION_FN(httpStatus, contentType)
      throw new FST_ERR_MISSING_SERIALIZATION_FN(httpStatus)
    }
  } else {
    // Check if serialize function already compiled
    if (this[kRouteContext][kReplyCacheSerializeFns]?.has(schema)) {
      serialize = this[kRouteContext][kReplyCacheSerializeFns].get(schema)
    } else {
      serialize = this.compileSerializationSchema(schema, httpStatus, contentType)
    }
  }

  return serialize(input)
}

Reply.prototype.serialize = function (this: FY.Reply, payload: any) {
  if (this[kReplySerializer] !== null) {
    return this[kReplySerializer](payload)
  } else {
    if (this[kRouteContext] && this[kRouteContext][kReplySerializerDefault]) {
      return this[kRouteContext][kReplySerializerDefault](payload, this.raw.statusCode)
    } else {
      return serialize(this[kRouteContext], payload, this.raw.statusCode)
    }
  }
}

Reply.prototype.serializer = function (this: FY.Reply, fn: any) {
  this[kReplySerializer] = fn
  return this
}

Reply.prototype.type = function (this: FY.Reply, type: any) {
  this[kReplyHeaders]['content-type'] = type
  return this
}

Reply.prototype.redirect = function (this: FY.Reply, url: any, code: any) {
  if (!code) {
    code = this[kReplyHasStatusCode] ? this.raw.statusCode : 302
  }

  return this.header('location', url).code(code).send()
}

Reply.prototype.callNotFound = function (this: FY.Reply) {
  notFound(this)
  return this
}

// Make reply a thenable, so it could be used with async/await.
// See
// - https://github.com/fastify/fastify/issues/1864 for the discussions
// - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/then for the signature
Reply.prototype.then = function (this: FY.Reply, fulfilled: any, rejected: any) {
  if (this.sent) {
    fulfilled()
    return
  }

  eos(this.raw, (err: any) => {
    // We must not treat ERR_STREAM_PREMATURE_CLOSE as
    // an error because it is created by eos, not by the stream.
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      if (rejected) {
        rejected(err)
      } else {
        this.log && this.log.warn('unhandled rejection on reply.then')
      }
    } else {
      fulfilled()
    }
  })
}

function preSerializationHook (reply: FY.Reply, payload: any) {
  if (reply[kRouteContext].preSerialization !== null) {
    preSerializationHookRunner(
      reply[kRouteContext].preSerialization,
      reply.request,
      reply,
      payload,
      preSerializationHookEnd
    )
  } else {
    preSerializationHookEnd(null, reply.request, reply, payload)
  }
}

function preSerializationHookEnd (err: any, request: FY.Request, reply: FY.Reply, payload: any) {
  if (err != null) {
    onErrorHook(reply, err)
    return
  }

  try {
    if (reply[kReplySerializer] !== null) {
      payload = reply[kReplySerializer](payload)
    } else if (reply[kRouteContext] && reply[kRouteContext][kReplySerializerDefault]) {
      payload = reply[kRouteContext][kReplySerializerDefault](payload, reply.raw.statusCode)
    } else {
      payload = serialize(reply[kRouteContext], payload, reply.raw.statusCode, reply[kReplyHeaders]['content-type'])
    }
  } catch (e: any) {
    wrapSerializationError(e, reply)
    onErrorHook(reply, e)
    return
  }

  onSendHook(reply, payload)
}

function wrapSerializationError (error: any, reply: FY.Reply) {
  error.serialization = reply[kRouteContext].config
}

function onSendHook (reply: FY.Reply, payload: any) {
  if (reply[kRouteContext].onSend !== null) {
    onSendHookRunner(
      reply[kRouteContext].onSend,
      reply.request,
      reply,
      payload,
      wrapOnSendEnd
    )
  } else {
    onSendEnd(reply, payload)
  }
}

function wrapOnSendEnd (err: any, request: FY.Request, reply: FY.Reply, payload: any) {
  if (err != null) {
    onErrorHook(reply, err)
  } else {
    onSendEnd(reply, payload)
  }
}

function safeWriteHead (reply: FY.Reply, statusCode: any) {
  const res = reply.raw
  try {
    res.writeHead(statusCode, reply[kReplyHeaders])
  } catch (err: any) {
    if (err.code === 'ERR_HTTP_HEADERS_SENT') {
      reply.log.warn(`Reply was already sent, did you forget to "return reply" in the "${reply.request.raw.url}" (${reply.request.raw.method}) route?`)
    }
    throw err
  }
}

function onSendEnd (reply: FY.Reply, payload: any) {
  const res = reply.raw
  const req = reply.request

  // we check if we need to update the trailers header and set it
  if (reply[kReplyTrailers] !== null) {
    const trailerHeaders = Object.keys(reply[kReplyTrailers])
    let header = ''
    for (const trailerName of trailerHeaders) {
      if (typeof reply[kReplyTrailers][trailerName] !== 'function') continue
      header += ' '
      header += trailerName
    }
    // it must be chunked for trailer to work
    reply.header('Transfer-Encoding', 'chunked')
    reply.header('Trailer', header.trim())
  }

  // since Response contain status code, headers and body,
  // we need to update the status, add the headers and use it's body as payload
  // before continuing
  if (toString.call(payload) === '[object Response]') {
    // https://developer.mozilla.org/en-US/docs/Web/API/Response/status
    if (typeof payload.status === 'number') {
      reply.code(payload.status)
    }

    // https://developer.mozilla.org/en-US/docs/Web/API/Response/headers
    if (typeof payload.headers === 'object' && typeof payload.headers.forEach === 'function') {
      for (const [headerName, headerValue] of payload.headers) {
        reply.header(headerName, headerValue)
      }
    }

    // https://developer.mozilla.org/en-US/docs/Web/API/Response/body
    if (payload.body !== null) {
      if (payload.bodyUsed) {
        throw new FST_ERR_REP_RESPONSE_BODY_CONSUMED()
      }
    }
    // Keep going, body is either null or ReadableStream
    payload = payload.body
  }
  const statusCode = res.statusCode

  if (payload === undefined || payload === null) {
    // according to https://datatracker.ietf.org/doc/html/rfc7230#section-3.3.2
    // we cannot send a content-length for 304 and 204, and all status code
    // < 200
    // A sender MUST NOT send a Content-Length header field in any message
    // that contains a Transfer-Encoding header field.
    // For HEAD we don't overwrite the `content-length`
    if (statusCode >= 200 && statusCode !== 204 && statusCode !== 304 && req.method !== 'HEAD' && reply[kReplyTrailers] === null) {
      reply[kReplyHeaders]['content-length'] = '0'
    }

    safeWriteHead(reply, statusCode)
    sendTrailer(payload, res, reply)
    return
  }

  if ((statusCode >= 100 && statusCode < 200) || statusCode === 204) {
    // Responses without a content body must not send content-type
    // or content-length headers.
    // See https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6.
    reply.removeHeader('content-type')
    reply.removeHeader('content-length')
    safeWriteHead(reply, statusCode)
    sendTrailer(undefined, res, reply)
    if (typeof payload.resume === 'function') {
      payload.on('error', noop)
      payload.resume()
    }
    return
  }

  // node:stream
  if (typeof payload.pipe === 'function') {
    sendStream(payload, res, reply)
    return
  }

  // node:stream/web
  if (typeof payload.getReader === 'function') {
    sendWebStream(payload, res, reply)
    return
  }

  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
    throw new FST_ERR_REP_INVALID_PAYLOAD_TYPE(typeof payload)
  }

  if (reply[kReplyTrailers] === null) {
    const contentLength = reply[kReplyHeaders]['content-length']
    if (!contentLength ||
      (req.raw.method !== 'HEAD' &&
        Number(contentLength) !== Buffer.byteLength(payload)
      )
    ) {
      reply[kReplyHeaders]['content-length'] = '' + Buffer.byteLength(payload)
    }
  }

  safeWriteHead(reply, statusCode)
  // write payload first
  res.write(payload)
  // then send trailers
  sendTrailer(payload, res, reply)
}

function logStreamError (logger: any, err: any, res: any) {
  if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
    if (!logger[kDisableRequestLogging]) {
      logger.info({ res }, 'stream closed prematurely')
    }
  } else {
    logger.warn({ err }, 'response terminated with an error with headers already sent')
  }
}

function sendWebStream (payload: any, res: any, reply: FY.Reply) {
  if (payload.locked) {
    throw FST_ERR_REP_READABLE_STREAM_LOCKED()
  }
  const nodeStream = Readable.fromWeb(payload)
  sendStream(nodeStream, res, reply)
}

function sendStream (payload: any, res: any, reply: FY.Reply) {
  let sourceOpen = true
  let errorLogged = false

  // set trailer when stream ended
  sendStreamTrailer(payload, res, reply)

  eos(payload, { readable: true, writable: false }, function (err: any) {
    sourceOpen = false
    if (err != null) {
      if (res.headersSent || reply.request.raw.aborted === true) {
        if (!errorLogged) {
          errorLogged = true
          logStreamError(reply.log, err, reply)
        }
        res.destroy()
      } else {
        onErrorHook(reply, err)
      }
    }
    // there is nothing to do if there is not an error
  })

  eos(res, function (err: any) {
    if (sourceOpen) {
      if (err != null && res.headersSent && !errorLogged) {
        errorLogged = true
        logStreamError(reply.log, err, res)
      }
      if (typeof payload.destroy === 'function') {
        payload.destroy()
      } else if (typeof payload.close === 'function') {
        payload.close(noop)
      } else if (typeof payload.abort === 'function') {
        payload.abort()
      } else {
        reply.log.warn('stream payload does not end properly')
      }
    }
  })

  // streams will error asynchronously, and we want to handle that error
  // appropriately, e.g. a 404 for a missing file. So we cannot use
  // writeHead, and we need to resort to setHeader, which will trigger
  // a writeHead when there is data to send.
  if (!res.headersSent) {
    for (const key in reply[kReplyHeaders]) {
      res.setHeader(key, reply[kReplyHeaders][key])
    }
  } else {
    reply.log.warn('response will send, but you shouldn\'t use res.writeHead in stream mode')
  }
  payload.pipe(res)
}

function sendTrailer (payload: any, res: any, reply: FY.Reply) {
  if (reply[kReplyTrailers] === null) {
    // when no trailer, we close the stream
    res.end(null, null, null) // avoid ArgumentsAdaptorTrampoline from V8
    return
  }
  const trailerHeaders = Object.keys(reply[kReplyTrailers])
  const trailers: { [name: string]: any } = {}
  let handled = 0
  let skipped = true
  function send () {
    // add trailers when all handler handled
    /* istanbul ignore else */
    if (handled === 0) {
      res.addTrailers(trailers)
      // we need to properly close the stream
      // after trailers sent
      res.end(null, null, null) // avoid ArgumentsAdaptorTrampoline from V8
    }
  }

  for (const trailerName of trailerHeaders) {
    if (typeof reply[kReplyTrailers][trailerName] !== 'function') continue
    skipped = false
    handled--

    function cb (err: any, value: any) {
      // TODO: we may protect multiple callback calls
      //       or mixing async-await with callback
      handled++

      // we can safely ignore error for trailer
      // since it does affect the client
      // we log in here only for debug usage
      if (err) reply.log.debug(err)
      else trailers[trailerName] = value

      // we push the check to the end of event
      // loop, so the registration continue to
      // process.
      process.nextTick(send)
    }

    const result = reply[kReplyTrailers][trailerName](reply, payload, cb)
    if (typeof result === 'object' && typeof result.then === 'function') {
      result.then((v: any) => cb(null, v), cb)
    }
  }

  // when all trailers are skipped
  // we need to close the stream
  if (skipped) res.end(null, null, null) // avoid ArgumentsAdaptorTrampoline from V8
}

function sendStreamTrailer (payload: any, res: any, reply: FY.Reply) {
  if (reply[kReplyTrailers] === null) return
  payload.on('end', () => sendTrailer(null, res, reply))
}

function onErrorHook (reply: FY.Reply, error: any, cb?: Function) {
  if (reply[kRouteContext].onError !== null && !reply[kReplyNextErrorHandler]) {
    reply[kReplyIsRunningOnErrorHook] = true
    onSendHookRunner(
      reply[kRouteContext].onError,
      reply.request,
      reply,
      error,
      () => handleError(reply, error, cb)
    )
  } else {
    handleError(reply, error, cb)
  }
}

function setupResponseListeners (reply: FY.Reply) {
  reply[kReplyStartTime] = now()

  const onResFinished = (err: any) => {
    reply[kReplyEndTime] = now()
    reply.raw.removeListener('finish', onResFinished)
    reply.raw.removeListener('error', onResFinished)

    const ctx = reply[kRouteContext]

    if (ctx && ctx.onResponse !== null) {
      onResponseHookRunner(
        ctx.onResponse,
        reply.request,
        reply,
        onResponseCallback
      )
    } else {
      onResponseCallback(err, reply.request, reply)
    }
  }

  reply.raw.on('finish', onResFinished)
  reply.raw.on('error', onResFinished)
}

function onResponseCallback (err: any, request: FY.Request, reply: FY.Reply) {
  if (reply.log[kDisableRequestLogging]) {
    return
  }

  const responseTime = reply.elapsedTime

  if (err != null) {
    reply.log.error({
      res: reply,
      err,
      responseTime
    }, 'request errored')
    return
  }

  reply.log.info({
    res: reply,
    responseTime
  }, 'request completed')
}

function buildReply (R: any) {
  const props = R.props.slice()

  function _Reply (this: FY.Reply, res: FY.Outgoing, request: FY.Request, log: any) {
    this.raw = res
    this[kReplyIsError] = false
    this[kReplyErrorHandlerCalled] = false
    this[kReplyHijacked] = false
    this[kReplySerializer] = null
    this.request = request
    this[kReplyHeaders] = {}
    this[kReplyTrailers] = null
    this[kReplyStartTime] = undefined
    this[kReplyEndTime] = undefined
    this.log = log

    let prop

    for (let i = 0; i < props.length; i++) {
      prop = props[i]
      ;(this as any)[prop!.key] = prop!.value
    }
  }
  Object.setPrototypeOf(_Reply.prototype, R.prototype)
  Object.setPrototypeOf(_Reply, R)
  _Reply.parent = R
  _Reply.props = props
  return _Reply
}

function notFound (reply: FY.Reply) {
  if (reply[kRouteContext][kFourOhFourContext] === null) {
    reply.log.warn('Trying to send a NotFound error inside a 404 handler. Sending basic 404 response.')
    reply.code(404).send('404 Not Found')
    return
  }

  reply.request[kRouteContext] = reply[kRouteContext][kFourOhFourContext]

  // preHandler hook
  if (reply[kRouteContext].preHandler !== null) {
    preHandlerHookRunner(
      reply[kRouteContext].preHandler,
      reply.request,
      reply,
      internals.preHandlerCallback
    )
  } else {
    internals.preHandlerCallback(null, reply.request, reply)
  }
}

/**
 * This function runs when a payload that is not a string|buffer|stream or null
 * should be serialized to be streamed to the response.
 * This is the default serializer that can be customized by the user using the replySerializer
 *
 * @param {object} context the request context
 * @param {object} data the JSON payload to serialize
 * @param {number} statusCode the http status code
 * @param {string} [contentType] the reply content type
 * @returns {string} the serialized payload
 */
function serialize (context: FY.Context, data: any, statusCode: number, contentType?: string) {
  const fnSerialize = getSchemaSerializer(context, statusCode, contentType)
  if (fnSerialize) {
    return fnSerialize(data)
  }
  return JSON.stringify(data)
}

function noop () { }

module.exports = Reply
module.exports.buildReply = buildReply
module.exports.setupResponseListeners = setupResponseListeners

declare var require: (name: string) => any;
declare var module: { exports: any };
declare const FS: {
  readonly kAvvioBoot: unique symbol;
  readonly kChildren: unique symbol;
  readonly kServerBindings: unique symbol;
  readonly kBodyLimit: unique symbol;
  readonly kSupportedHTTPMethods: unique symbol;
  readonly kRoutePrefix: unique symbol;
  readonly kLogLevel: unique symbol;
  readonly kLogSerializers: unique symbol;
  readonly kHooks: unique symbol;
  readonly kContentTypeParser: unique symbol;
  readonly kState: unique symbol;
  readonly kOptions: unique symbol;
  readonly kDisableRequestLogging: unique symbol;
  readonly kPluginNameChain: unique symbol;
  readonly kRouteContext: unique symbol;
  readonly kGenReqId: unique symbol;
  readonly kSchemaController: unique symbol;
  readonly kSchemaHeaders: unique symbol;
  readonly kSchemaParams: unique symbol;
  readonly kSchemaQuerystring: unique symbol;
  readonly kSchemaBody: unique symbol;
  readonly kSchemaResponse: unique symbol;
  readonly kSchemaErrorFormatter: unique symbol;
  readonly kSchemaVisited: unique symbol;
  readonly kRequest: unique symbol;
  readonly kRequestPayloadStream: unique symbol;
  readonly kRequestAcceptVersion: unique symbol;
  readonly kRequestCacheValidateFns: unique symbol;
  readonly kRequestOriginalUrl: unique symbol;
  readonly kFourOhFour: unique symbol;
  readonly kCanSetNotFoundHandler: unique symbol;
  readonly kFourOhFourLevelInstance: unique symbol;
  readonly kFourOhFourContext: unique symbol;
  readonly kDefaultJsonParse: unique symbol;
  readonly kReply: unique symbol;
  readonly kReplySerializer: unique symbol;
  readonly kReplyIsError: unique symbol;
  readonly kReplyHeaders: unique symbol;
  readonly kReplyTrailers: unique symbol;
  readonly kReplyHasStatusCode: unique symbol;
  readonly kReplyHijacked: unique symbol;
  readonly kReplyStartTime: unique symbol;
  readonly kReplyNextErrorHandler: unique symbol;
  readonly kReplyEndTime: unique symbol;
  readonly kReplyErrorHandlerCalled: unique symbol;
  readonly kReplyIsRunningOnErrorHook: unique symbol;
  readonly kReplySerializerDefault: unique symbol;
  readonly kReplyCacheSerializeFns: unique symbol;
  readonly kTestInternals: unique symbol;
  readonly kErrorHandler: unique symbol;
  readonly kChildLoggerFactory: unique symbol;
  readonly kHasBeenDecorated: unique symbol;
  readonly kKeepAliveConnections: unique symbol;
  readonly kRouteByFastify: unique symbol;
};
declare namespace FY {
  type Done = (error?: any, value?: any) => void;
  type Hook = Function;
  interface Headers { [name: string]: any }
  interface Context {
    schema: any; handler: Function; Reply: ReplyConstructor; Request: RequestConstructor; contentTypeParser: any;
    onRequest: Hook[] | null; onSend: Hook[] | null; onError: Hook[] | null; onTimeout: Hook[] | null; preHandler: Hook[] | null; onResponse: Hook[] | null;
    preSerialization: Hook[] | null; onRequestAbort: Hook[] | null; preParsing?: Hook[] | null; preValidation?: Hook[] | null;
    config: any; errorHandler: any; requestIdLogLabel: string; childLoggerFactory: Function; _middie: any; _parserOptions: { limit: number };
    exposeHeadRoute: any; prefixTrailingSlash: any; logLevel: string; logSerializers: any; attachValidation: boolean | undefined;
    schemaErrorFormatter: Function; validatorCompiler: Function | null; serializerCompiler: Function | null; server: any;
    [FS.kFourOhFourContext]: Context | null; [FS.kReplySerializerDefault]: Function | undefined; [FS.kRouteByFastify]: boolean | undefined;
    [FS.kRequestCacheValidateFns]: WeakMap<object, Function> | null; [FS.kReplyCacheSerializeFns]: WeakMap<object, any> | null;
    [FS.kSchemaResponse]?: any; [FS.kSchemaBody]?: any; [FS.kSchemaHeaders]?: any; [FS.kSchemaParams]?: any; [FS.kSchemaQuerystring]?: any;
  }
  type RequestConstructor = { new (id: unknown, params: unknown, req: Incoming, query: unknown, log: any, context: Context): Request; props: Decoration[]; parent?: RequestConstructor; prototype: any; [FS.kHasBeenDecorated]?: boolean };
  type ReplyConstructor = { new (res: Outgoing, request: Request, log: any): Reply; props: Decoration[]; parent?: ReplyConstructor; prototype: any };
  interface Decoration { key: string; value: unknown }
  type Incoming = import("node:http").IncomingMessage;
  type Outgoing = import("node:http").ServerResponse;
  interface Request {
    id: unknown; params: unknown; raw: Incoming; query: unknown; log: any; body: unknown;
    [FS.kRouteContext]: Context; [FS.kRequestOriginalUrl]?: string; [FS.kRequestPayloadStream]?: any;
    readonly server: any; readonly url: string; readonly originalUrl: string; readonly method: string; readonly routeOptions: any; readonly is404: boolean;
    readonly socket: any; readonly ip: string | undefined; readonly ips?: string[]; readonly host: string; readonly hostname: string; readonly port: number | null;
    readonly protocol: string | undefined; headers: Headers; additionalHeaders?: Headers; validationError?: any;
    getValidationFunction(httpPartOrSchema: any): any; compileValidationSchema(schema: any, httpPart?: any): any; validateInput(input: any, schema: any, httpPart?: any): any;
  }
  interface Reply {
    raw: Outgoing; request: Request; log: any;
    [FS.kReplySerializer]: Function | null; [FS.kReplyErrorHandlerCalled]: boolean; [FS.kReplyIsError]: boolean; [FS.kReplyIsRunningOnErrorHook]: boolean;
    [FS.kReplyHeaders]: Headers; [FS.kReplyTrailers]: { [name: string]: Function } | null; [FS.kReplyHasStatusCode]: boolean; [FS.kReplyStartTime]: number | undefined;
    [FS.kReplyEndTime]?: number; [FS.kReplyHijacked]?: boolean; [FS.kReplyNextErrorHandler]?: any;
    readonly [FS.kRouteContext]: Context; readonly elapsedTime: number; readonly server: any; readonly sent: boolean; statusCode: number; readonly routeOptions: any;
    writeEarlyHints(hints: any, callback?: any): Reply; hijack(): Reply; send(payload?: any): Reply; getHeader(key: string): any; getHeaders(): Headers; hasHeader(key: string): boolean;
    removeHeader(key: string): Reply; header(key: string, value?: any): Reply; headers(headers: Headers): Reply; trailer(key: string, fn: Function): Reply; hasTrailer(key: string): boolean;
    removeTrailer(key: string): Reply; code(code: number): Reply; status(code: number): Reply; getSerializationFunction(schemaOrStatus: any, contentType?: any): any;
    compileSerializationSchema(schema: any, httpStatus?: any, contentType?: any): any; serializeInput(input: any, schema: any, httpStatus?: any, contentType?: any): any;
    serialize(payload: any): any; serializer(fn: Function): Reply; type(type: string): Reply; redirect(url: string, code?: number): Reply; callNotFound(): Reply;
    then(fulfilled: Function, rejected?: Function): void;
  }
}
