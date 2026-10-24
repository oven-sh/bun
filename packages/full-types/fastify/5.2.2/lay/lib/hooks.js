'use strict'

const applicationHooks = [
  'onRoute',
  'onRegister',
  'onReady',
  'onListen',
  'preClose',
  'onClose'
]
const lifecycleHooks = [
  'onTimeout',
  'onRequest',
  'preParsing',
  'preValidation',
  'preSerialization',
  'preHandler',
  'onSend',
  'onResponse',
  'onError',
  'onRequestAbort'
]
const supportedHooks = lifecycleHooks.concat(applicationHooks)
const {
  FST_ERR_HOOK_INVALID_TYPE,
  FST_ERR_HOOK_INVALID_HANDLER,
  FST_ERR_SEND_UNDEFINED_ERR,
  FST_ERR_HOOK_TIMEOUT,
  FST_ERR_HOOK_NOT_SUPPORTED,
  AVVIO_ERRORS_MAP,
  appendStackTrace
} = require('./errors')

const {
  kChildren,
  kHooks,
  kRequestPayloadStream
}: typeof FS = require('./symbols')

function Hooks (this: any) {
  this.onRequest = []
  this.preParsing = []
  this.preValidation = []
  this.preSerialization = []
  this.preHandler = []
  this.onResponse = []
  this.onSend = []
  this.onError = []
  this.onRoute = []
  this.onRegister = []
  this.onReady = []
  this.onListen = []
  this.onTimeout = []
  this.onRequestAbort = []
  this.preClose = []
}

Hooks.prototype = Object.create(null)

Hooks.prototype.validate = function (hook: any, fn: any) {
  if (typeof hook !== 'string') throw new FST_ERR_HOOK_INVALID_TYPE()
  if (Array.isArray(this[hook]) === false) {
    throw new FST_ERR_HOOK_NOT_SUPPORTED(hook)
  }
  if (typeof fn !== 'function') throw new FST_ERR_HOOK_INVALID_HANDLER(hook, Object.prototype.toString.call(fn))
}

Hooks.prototype.add = function (hook: any, fn: any) {
  this.validate(hook, fn)
  this[hook].push(fn)
}

function buildHooks (h: any) {
  const hooks = new (Hooks as any)()
  hooks.onRequest = h.onRequest.slice()
  hooks.preParsing = h.preParsing.slice()
  hooks.preValidation = h.preValidation.slice()
  hooks.preSerialization = h.preSerialization.slice()
  hooks.preHandler = h.preHandler.slice()
  hooks.onSend = h.onSend.slice()
  hooks.onResponse = h.onResponse.slice()
  hooks.onError = h.onError.slice()
  hooks.onRoute = h.onRoute.slice()
  hooks.onRegister = h.onRegister.slice()
  hooks.onTimeout = h.onTimeout.slice()
  hooks.onRequestAbort = h.onRequestAbort.slice()
  hooks.onReady = []
  hooks.onListen = []
  hooks.preClose = []
  return hooks
}

function hookRunnerApplication (hookName: any, boot: any, server: any, cb: Function) {
  const hooks = server[kHooks][hookName]
  let i = 0
  let c = 0

  next()

  function exit (err?: any) {
    const hookFnName = hooks[i - 1]?.name
    const hookFnFragment = hookFnName ? ` "${hookFnName}"` : ''

    if (err) {
      if (err.code === 'AVV_ERR_READY_TIMEOUT') {
        err = appendStackTrace(err, new FST_ERR_HOOK_TIMEOUT(hookName, hookFnFragment))
      } else {
        err = AVVIO_ERRORS_MAP[err.code] != null
          ? appendStackTrace(err, new AVVIO_ERRORS_MAP[err.code](err.message))
          : err
      }

      cb(err)
      return
    }
    cb()
  }

  function next (err?: any): any {
    if (err) {
      exit(err)
      return
    }

    if (i === hooks.length && c === server[kChildren].length) {
      if (i === 0 && c === 0) { // speed up start
        exit()
      } else {
        // This is the last function executed for every fastify instance
        boot(function manageTimeout (err: any, done: any) {
          // this callback is needed by fastify to provide an hook interface without the error
          // as first parameter and managing it on behalf the user
          exit(err)

          // this callback is needed by avvio to continue the loading of the next `register` plugins
          done(err)
        })
      }
      return
    }

    if (i === hooks.length && c < server[kChildren].length) {
      const child = server[kChildren][c++]
      hookRunnerApplication(hookName, boot, child, next)
      return
    }

    boot(wrap(hooks[i++], server))
    next()
  }

  function wrap (fn: any, server: any) {
    return function (err: any, done: any) {
      if (err) {
        done(err)
        return
      }

      if (fn.length === 1) {
        try {
          fn.call(server, done)
        } catch (error: any) {
          done(error)
        }
        return
      }

      try {
        const ret = fn.call(server)
        if (ret && typeof ret.then === 'function') {
          ret.then(done, done)
          return
        }
      } catch (error: any) {
        err = error
      }

      done(err) // auto done
    }
  }
}

function onListenHookRunner (server: any) {
  const hooks = server[kHooks].onListen
  const hooksLen = hooks.length

  let i = 0
  let c = 0

  next()

  function next (err?: any): any {
    err && server.log.error(err)

    if (
      i === hooksLen
    ) {
      while (c < server[kChildren].length) {
        const child = server[kChildren][c++]
        onListenHookRunner(child)
      }
      return
    }

    wrap(hooks[i++], server, next)
  }

  async function wrap (fn: any, server: any, done: any) {
    if (fn.length === 1) {
      try {
        fn.call(server, done)
      } catch (e: any) {
        done(e)
      }
      return
    }
    try {
      const ret = fn.call(server)
      if (ret && typeof ret.then === 'function') {
        ret.then(done, done)
        return
      }
      done()
    } catch (error: any) {
      done(error)
    }
  }
}

function hookRunnerGenerator (iterator: any) {
  return function hookRunner (functions: FY.Hook[], request: FY.Request, reply: FY.Reply, cb: Function) {
    let i = 0

    function next (err?: any): any {
      if (err || i === functions.length) {
        cb(err, request, reply)
        return
      }

      let result
      try {
        result = iterator(functions[i++], request, reply, next)
      } catch (error: any) {
        cb(error, request, reply)
        return
      }
      if (result && typeof result.then === 'function') {
        result.then(handleResolve, handleReject)
      }
    }

    function handleResolve () {
      next()
    }

    function handleReject (err: any) {
      if (!err) {
        err = new FST_ERR_SEND_UNDEFINED_ERR()
      }

      cb(err, request, reply)
    }

    next()
  }
}

function onResponseHookIterator (fn: any, request: FY.Request, reply: FY.Reply, next: any) {
  return fn(request, reply, next)
}

const onResponseHookRunner = hookRunnerGenerator(onResponseHookIterator)
const preValidationHookRunner = hookRunnerGenerator(hookIterator)
const preHandlerHookRunner = hookRunnerGenerator(hookIterator)
const onTimeoutHookRunner = hookRunnerGenerator(hookIterator)
const onRequestHookRunner = hookRunnerGenerator(hookIterator)

function onSendHookRunner (functions: FY.Hook[], request: FY.Request, reply: FY.Reply, payload: any, cb: Function) {
  let i = 0

  function next (err?: any, newPayload?: any): any {
    if (err) {
      cb(err, request, reply, payload)
      return
    }

    if (newPayload !== undefined) {
      payload = newPayload
    }

    if (i === functions.length) {
      cb(null, request, reply, payload)
      return
    }

    let result
    try {
      result = functions[i++]!(request, reply, payload, next)
    } catch (error: any) {
      cb(error, request, reply)
      return
    }
    if (result && typeof result.then === 'function') {
      result.then(handleResolve, handleReject)
    }
  }

  function handleResolve (newPayload: any) {
    next(null, newPayload)
  }

  function handleReject (err: any) {
    if (!err) {
      err = new FST_ERR_SEND_UNDEFINED_ERR()
    }

    cb(err, request, reply, payload)
  }

  next()
}

const preSerializationHookRunner = onSendHookRunner

function preParsingHookRunner (functions: FY.Hook[], request: FY.Request, reply: FY.Reply, cb: Function) {
  let i = 0

  function next (err?: any, newPayload?: any): any {
    if (reply.sent) {
      return
    }

    if (newPayload !== undefined) {
      request[kRequestPayloadStream] = newPayload
    }

    if (err || i === functions.length) {
      cb(err, request, reply)
      return
    }

    let result
    try {
      result = functions[i++]!(request, reply, request[kRequestPayloadStream], next)
    } catch (error: any) {
      cb(error, request, reply)
      return
    }

    if (result && typeof result.then === 'function') {
      result.then(handleResolve, handleReject)
    }
  }

  function handleResolve (newPayload: any) {
    next(null, newPayload)
  }

  function handleReject (err: any) {
    if (!err) {
      err = new FST_ERR_SEND_UNDEFINED_ERR()
    }

    cb(err, request, reply)
  }

  next()
}

function onRequestAbortHookRunner (functions: FY.Hook[], request: FY.Request, cb: Function) {
  let i = 0

  function next (err?: any): any {
    if (err || i === functions.length) {
      cb(err, request)
      return
    }

    let result
    try {
      result = functions[i++]!(request, next)
    } catch (error: any) {
      cb(error, request)
      return
    }
    if (result && typeof result.then === 'function') {
      result.then(handleResolve, handleReject)
    }
  }

  function handleResolve () {
    next()
  }

  function handleReject (err: any) {
    if (!err) {
      err = new FST_ERR_SEND_UNDEFINED_ERR()
    }

    cb(err, request)
  }

  next()
}

function hookIterator (fn: any, request: FY.Request, reply: FY.Reply, next: any) {
  if (reply.sent === true) return undefined
  return fn(request, reply, next)
}

module.exports = {
  Hooks,
  buildHooks,
  hookRunnerGenerator,
  preParsingHookRunner,
  onResponseHookRunner,
  onSendHookRunner,
  preSerializationHookRunner,
  onRequestAbortHookRunner,
  hookIterator,
  hookRunnerApplication,
  onListenHookRunner,
  preHandlerHookRunner,
  preValidationHookRunner,
  onRequestHookRunner,
  onTimeoutHookRunner,
  lifecycleHooks,
  supportedHooks
}

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
