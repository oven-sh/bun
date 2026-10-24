'use strict'

/**
 * Module dependencies.
 */
const util = require('node:util')
const v8 = require('node:v8')
const debug = util.debuglog('koa:application')
const Emitter: typeof import("node:events").EventEmitter = require('node:events')
const Stream = require('node:stream')
const http = require('node:http')
const { AsyncLocalStorage } = require('node:async_hooks')

const onFinished = require('on-finished')
const compose = require('koa-compose')
const statuses = require('statuses')
const { HttpError } = require('http-errors')

const request = require('./request')
const response = require('./response')
const context = require('./context')
const isStream = require('./is-stream.js')
const only = require('./only.js')

/** @typedef {typeof import ('./context') & {
 *  app: Application
 *  req: import('http').IncomingMessage
 *  res: import('http').ServerResponse
 *  request: KoaRequest
 *  response: KoaResponse
 *  state: any
 *  originalUrl: string
 * }} Context */

/** @typedef {typeof import('./request')} KoaRequest */

/** @typedef {typeof import('./response')} KoaResponse */

/**
 * Expose `Application` class.
 * Inherits from `Emitter.prototype`.
 */

function getAsyncLocalStorage (options: KT.Options) {
  if (options.asyncLocalStorage instanceof AsyncLocalStorage) {
    return options.asyncLocalStorage
  }
  return new AsyncLocalStorage()
}

module.exports = class Application extends Emitter implements KT.App {
  declare proxy: boolean
  declare subdomainOffset: number
  declare proxyIpHeader: string
  declare maxIpsCount: number
  declare env: string
  declare compose: (middleware: KT.Middleware[]) => KT.Composed
  declare keys?: any
  declare silent?: boolean
  declare ctxStorage?: any
  declare middleware: KT.Middleware[]
  declare context: KT.Context
  declare request: KT.Request
  declare response: KT.Response
  /**
   * Initialize a new `Application`.
   *
   * @api public
   */

  /**
   *
   * @param {object} [options] Application options
   * @param {string} [options.env='development'] Environment
   * @param {string[]} [options.keys] Signed cookie keys
   * @param {boolean} [options.proxy] Trust proxy headers
   * @param {number} [options.subdomainOffset] Subdomain offset
   * @param {string} [options.proxyIpHeader] Proxy IP header, defaults to X-Forwarded-For
   * @param {number} [options.maxIpsCount] Max IPs read from proxy IP header, default to 0 (means infinity)
   * @param {function} [options.compose] Function to handle middleware composition
   * @param {boolean} [options.asyncLocalStorage] Enable AsyncLocalStorage, default to false
   *
   */

  constructor (options?: KT.Options) {
    super()
    options = options || {}
    this.proxy = options.proxy || false
    this.subdomainOffset = options.subdomainOffset || 2
    this.proxyIpHeader = options.proxyIpHeader || 'X-Forwarded-For'
    this.maxIpsCount = options.maxIpsCount || 0
    this.env = options.env || process.env.NODE_ENV || 'development'
    this.compose = options.compose || compose
    if (options.keys) this.keys = options.keys
    this.middleware = []
    this.context = Object.create(context)
    this.request = Object.create(request)
    this.response = Object.create(response)
    // util.inspect.custom support for node 6+
    /* istanbul ignore else */
    if (util.inspect.custom) {
      (this as any)[util.inspect.custom] = this.inspect
    }
    if (options.asyncLocalStorage) {
      if (v8.startupSnapshot?.isBuildingSnapshot?.()) {
        this.ctxStorage = null
        v8.startupSnapshot.addDeserializeCallback(({ app, options }: { app: KT.App, options: KT.Options }) => {
          app.ctxStorage = getAsyncLocalStorage(options)
        }, { app: this, options })
      } else {
        this.ctxStorage = getAsyncLocalStorage(options)
      }
    }
  }

  /**
   * Shorthand for:
   *
   *    http.createServer(app.callback()).listen(...)
   *
   * @param {Mixed} ...
   * @return {import('http').Server}
   * @api public
   */

  listen (...args: any[]) {
    debug('listen')
    const server = http.createServer(this.callback())
    return server.listen(...args)
  }

  /**
   * Return JSON representation.
   * We only bother showing settings.
   *
   * @return {Object}
   * @api public
   */

  toJSON () {
    return only(this, ['subdomainOffset', 'proxy', 'env'])
  }

  /**
   * Inspect implementation.
   *
   * @return {Object}
   * @api public
   */

  inspect () {
    return this.toJSON()
  }

  /**
   * Use the given middleware `fn`.
   *
   * Old-style middleware will be converted.
   *
   * @param {(context: Context) => Promise<any | void>} fn
   * @return {Application} self
   * @api public
   */

  use (fn: KT.Middleware) {
    if (typeof fn !== 'function') { throw new TypeError('middleware must be a function!') }
    debug('use %s', fn._name || fn.name || '-')
    this.middleware.push(fn)
    return this
  }

  /**
   * Return a request handler callback
   * for node's native http server.
   *
   * @return {Function}
   * @api public
   */

  callback () {
    const fn = this.compose(this.middleware)

    if (!this.listenerCount('error')) this.on('error', this.onerror)

    const handleRequest = (req: KT.Incoming, res: KT.Outgoing) => {
      const ctx = this.createContext(req, res)
      if (!this.ctxStorage) {
        return this.handleRequest(ctx, fn)
      }
      return this.ctxStorage.run(ctx, async () => {
        return await this.handleRequest(ctx, fn)
      })
    }

    return handleRequest
  }

  /**
   * return current context from async local storage
   */
  get currentContext () {
    if (this.ctxStorage) return this.ctxStorage.getStore()
  }

  /**
   * Handle request in callback.
   *
   * @api private
   */

  handleRequest (ctx: KT.Context, fnMiddleware: KT.Composed) {
    const res = ctx.res
    res.statusCode = 404
    const onerror = (err: any) => ctx.onerror(err)
    const handleResponse = () => respond(ctx)
    onFinished(res, onerror)
    return fnMiddleware(ctx).then(handleResponse).catch(onerror)
  }

  /**
   * Initialize a new context.
   *
   * @api private
   */

  createContext (req: KT.Incoming, res: KT.Outgoing): KT.Context {
    /** @type {Context} */
    const context: KT.Context = Object.create(this.context)
    /** @type {KoaRequest} */
    const request: KT.Request = (context.request = Object.create(this.request))
    /** @type {KoaResponse} */
    const response: KT.Response = (context.response = Object.create(this.response))
    context.app = request.app = response.app = this
    context.req = request.req = response.req = req
    context.res = request.res = response.res = res
    request.ctx = response.ctx = context
    request.response = response
    response.request = request
    context.originalUrl = request.originalUrl = req.url!
    context.state = {}
    return context
  }

  /**
   * Default error handler.
   *
   * @param {Error} err
   * @api private
   */

  onerror (err: any) {
    // When dealing with cross-globals a normal `instanceof` check doesn't work properly.
    // See https://github.com/koajs/koa/issues/1466
    // We can probably remove it once jest fixes https://github.com/facebook/jest/issues/2549.
    const isNativeError =
      Object.prototype.toString.call(err) === '[object Error]' ||
      err instanceof Error
    if (!isNativeError) { throw new TypeError(util.format('non-error thrown: %j', err)) }

    if (err.status === 404 || err.expose) return
    if (this.silent) return

    const msg = err.stack || err.toString()
    console.error(`\n${msg.replace(/^/gm, '  ')}\n`)
  }

  /**
   * Help TS users comply to CommonJS, ESM, bundler mismatch.
   * @see https://github.com/koajs/koa/issues/1513
   */

  static get default () {
    return Application
  }
}

/**
 * Response helper.
 */

function respond (ctx: KT.Context) {
  // allow bypassing koa
  if (ctx.respond === false) return

  const res = ctx.res

  if (!ctx.writable) return res.end()

  let body = ctx.body
  const code = ctx.status

  // ignore body
  if (statuses.empty[code]) {
    // strip headers
    ctx.body = null
    return res.end()
  }

  if (ctx.method === 'HEAD') {
    if (!res.headersSent && !ctx.response.has('Content-Length')) {
      const { length } = ctx.response
      if (Number.isInteger(length)) ctx.length = length
    }
    return res.end()
  }

  // status body
  if (body === null || body === undefined) {
    if (ctx.response._explicitNullBody) {
      ctx.response.remove('Content-Type')
      ctx.response.remove('Transfer-Encoding')
      ctx.length = 0
      return res.end()
    }
    if (ctx.req.httpVersionMajor >= 2) {
      body = String(code)
    } else {
      body = ctx.message || String(code)
    }
    if (!res.headersSent) {
      ctx.type = 'text'
      ctx.length = Buffer.byteLength(body as string)
    }
    return res.end(body)
  }

  // responses

  if (Buffer.isBuffer(body)) return res.end(body)
  if (typeof body === 'string') return res.end(body)

  let stream = null
  if (body instanceof Blob) stream = Stream.Readable.from(body.stream())
  else if (body instanceof ReadableStream) stream = Stream.Readable.from(body)
  else if (body instanceof Response) stream = Stream.Readable.from(body?.body || '')
  else if (isStream(body)) stream = body

  if (stream) {
    return Stream.pipeline(stream, res, (err: any) => {
      if (err && ctx.app.listenerCount('error')) ctx.onerror(err)
    })
  }

  // body: json
  body = JSON.stringify(body)
  if (!res.headersSent) {
    ctx.length = Buffer.byteLength(body as string)
  }
  res.end(body)
}

/**
 * Make HttpError available to consumers of the library so that consumers don't
 * have a direct dependency upon `http-errors`
 */

module.exports.HttpError = HttpError

declare namespace KT {
  type Incoming = import("node:http").IncomingMessage;
  type Outgoing = import("node:http").ServerResponse;
  type Next = () => Promise<unknown>;
  interface Middleware { (context: Context, next?: Next): unknown; _name?: string }
  type Composed = (context: Context, next?: Next) => Promise<unknown>;
  interface Options {
    proxy?: boolean; subdomainOffset?: number; proxyIpHeader?: string; maxIpsCount?: number; env?: string;
    compose?: (middleware: Middleware[]) => Composed; keys?: any; asyncLocalStorage?: any;
  }
  interface App {
    proxy: boolean; subdomainOffset: number; proxyIpHeader: string; maxIpsCount: number; env: string;
    compose: (middleware: Middleware[]) => Composed; keys?: any; silent?: boolean; ctxStorage?: any;
    middleware: Middleware[]; context: Context; request: Request; response: Response;
    emit(name: string, ...values: any[]): boolean;
    listenerCount(name: string): number;
    toJSON(): object;
  }
  interface Request {
    app: App; req: Incoming; res: Outgoing; ctx: Context; response: Response; originalUrl: string;
    _querycache?: { [text: string]: Query }; memoizedURL?: URL; _accept?: any;
    header: import("node:http").IncomingHttpHeaders; headers: import("node:http").IncomingHttpHeaders;
    url: string; readonly origin: string | null; readonly href: string; method: string; path: string; query: Query; querystring: string; search: string;
    readonly host: string; readonly hostname: string; readonly URL: URL; readonly fresh: boolean; readonly stale: boolean; readonly idempotent: boolean;
    readonly socket: any; readonly charset: string; readonly length: number | undefined; readonly protocol: string; readonly secure: boolean;
    readonly ips: string[]; ip: string; readonly subdomains: string[]; accept: any; readonly type: string;
    accepts(...types: any[]): any; acceptsEncodings(...encodings: any[]): any; acceptsCharsets(...charsets: any[]): any; acceptsLanguages(...languages: any[]): any;
    is(type: any, ...types: any[]): any;
    get(field: string): string;
    inspect(): object | undefined; toJSON(): object;
  }
  interface Query { [name: string]: string | string[] | undefined }
  type HeaderValue = number | string | string[];
  interface Response {
    app: App; req: Incoming; res: Outgoing; ctx: Context; request: Request;
    _body?: unknown; _explicitStatus?: boolean; _explicitNullBody?: boolean;
    readonly socket: any; readonly header: import("node:http").OutgoingHttpHeaders; readonly headers: import("node:http").OutgoingHttpHeaders;
    status: number; message: string; body: unknown; length: number | undefined; readonly headerSent: boolean;
    type: string; lastModified: any; etag: any; readonly writable: boolean;
    vary(field: any): void; redirect(url: string): void; back(alt?: string): void; attachment(filename?: string, options?: any): void;
    is(type?: any, ...types: any[]): any;
    get(field: string): any; has(field: string): boolean; set(field: any, value?: any): void; append(field: string, value: any): void; remove(field: string): void;
    inspect(): object | undefined; toJSON(): { [name: string]: unknown }; flushHeaders(): void;
  }
  interface Context {
    app: App; req: Incoming; res: Outgoing; request: Request; response: Response; originalUrl: string; state: { [name: string]: any };
    respond?: boolean;
    inspect(): object; toJSON(): object; assert: any; throw(...values: any[]): never; onerror(error: any): void; cookies: any;
    attachment(filename?: string, options?: any): void; redirect(url: string): void; remove(field: string): void; vary(field: any): void;
    has(field: string): boolean; set(field: any, value?: any): void; append(field: string, value: any): void; flushHeaders(): void; back(alt?: string): void;
    status: number; message: string; body: unknown; length: number | undefined; type: string; lastModified: any; etag: any;
    readonly headerSent: boolean; readonly writable: boolean;
    acceptsLanguages(...languages: any[]): any; acceptsEncodings(...encodings: any[]): any; acceptsCharsets(...charsets: any[]): any; accepts(...types: any[]): any;
    get(field: string): string; is(type: any, ...types: any[]): any;
    querystring: string; idempotent: boolean; socket: any; search: string; method: string; query: Query; path: string; url: string; accept: any;
    readonly origin: string | null; readonly href: string; readonly subdomains: string[]; readonly protocol: string; readonly host: string; readonly hostname: string;
    readonly URL: URL; readonly header: import("node:http").IncomingHttpHeaders; readonly headers: import("node:http").IncomingHttpHeaders;
    readonly secure: boolean; readonly stale: boolean; readonly fresh: boolean; readonly ips: string[]; readonly ip: string;
  }
}
declare var require: (name: string) => any;
declare var module: { exports: any };
