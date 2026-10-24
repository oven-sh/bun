'use strict'

/**
 * Module dependencies.
 */

const util = require('util')
const createError = require('http-errors')
const httpAssert = require('http-assert')
const delegate = require('delegates')
const statuses = require('statuses')
const Cookies = require('cookies')

const COOKIES = Symbol('context#cookies')

/**
 * Context prototype.
 */

const proto = module.exports = {

  /**
   * util.inspect() implementation, which
   * just returns the JSON output.
   *
   * @return {Object}
   * @api public
   */

  inspect () {
    if (this === proto) return this
    return this.toJSON()
  },

  /**
   * Return JSON representation.
   *
   * Here we explicitly invoke .toJSON() on each
   * object, as iteration will otherwise fail due
   * to the getters and cause utilities such as
   * clone() to fail.
   *
   * @return {Object}
   * @api public
   */

  toJSON () {
    return {
      request: this.request.toJSON(),
      response: this.response.toJSON(),
      app: this.app.toJSON(),
      originalUrl: this.originalUrl,
      req: '<original node req>',
      res: '<original node res>',
      socket: '<original node socket>'
    }
  },

  /**
   * Similar to .throw(), adds assertion.
   *
   *    this.assert(this.user, 401, 'Please login!');
   *
   * See: https://github.com/jshttp/http-assert
   *
   * @param {Mixed} test
   * @param {Number} status
   * @param {String} message
   * @api public
   */

  assert: httpAssert,

  /**
   * Throw an error with `status` (default 500) and
   * `msg`. Note that these are user-level
   * errors, and the message may be exposed to the client.
   *
   *    this.throw(403)
   *    this.throw(400, 'name required')
   *    this.throw('something exploded')
   *    this.throw(new Error('invalid'))
   *    this.throw(400, new Error('invalid'))
   *
   * See: https://github.com/jshttp/http-errors
   *
   * Note: `status` should only be passed as the first parameter.
   *
   * @param {String|Number|Error} err, msg or status
   * @param {String|Number|Error} [err, msg or status]
   * @param {Object} [props]
   * @api public
   */

  throw (...args: any[]) {
    throw createError(...args)
  },

  /**
   * Default error handling.
   *
   * @param {Error} err
   * @api private
   */

  onerror (err: any) {
    // don't do anything if there is no error.
    // this allows you to pass `this.onerror`
    // to node-style callbacks.
    if (err == null) return

    // When dealing with cross-globals a normal `instanceof` check doesn't work properly.
    // See https://github.com/koajs/koa/issues/1466
    // We can probably remove it once jest fixes https://github.com/facebook/jest/issues/2549.
    const isNativeError =
      Object.prototype.toString.call(err) === '[object Error]' ||
      err instanceof Error
    if (!isNativeError) err = new Error(util.format('non-error thrown: %j', err))

    let headerSent = false
    if (this.headerSent || !this.writable) {
      headerSent = err.headerSent = true
    }

    // delegate
    this.app.emit('error', err, this)

    // nothing we can do here other
    // than delegate to the app-level
    // handler and log.
    if (headerSent) {
      return
    }

    const { res } = this

    // first unset all headers
    /* istanbul ignore else */
    if (typeof res.getHeaderNames === 'function') {
      res.getHeaderNames().forEach(name => res.removeHeader(name))
    } else {
      (res as any)._headers = {} // Node < 7.7
    }

    // then set those specified
    this.set(err.headers)

    // force text/plain
    this.type = 'text'

    let statusCode = err.status || err.statusCode

    // default to 500
    if (typeof statusCode !== 'number' || !statuses.message[statusCode]) statusCode = 500

    // respond
    const code = statuses.message[statusCode]
    const msg = err.expose ? err.message : code
    this.status = err.status = statusCode
    this.length = Buffer.byteLength(msg)
    res.end(msg)
  },

  get cookies () {
    if (!this[COOKIES]) {
      this[COOKIES] = new Cookies(this.req, this.res, {
        keys: this.app.keys,
        secure: this.request.secure
      })
    }
    return this[COOKIES]
  },

  set cookies (_cookies) {
    this[COOKIES] = _cookies
  }
} satisfies ThisType<KT.Context & { [COOKIES]?: any }>

/**
 * Custom inspection implementation for newer Node.js versions.
 *
 * @return {Object}
 * @api public
 */

/* istanbul ignore else */
if (util.inspect.custom) {
  module.exports[util.inspect.custom] = module.exports.inspect
}

/**
 * Response delegation.
 */

delegate(proto, 'response')
  .method('attachment')
  .method('redirect')
  .method('remove')
  .method('vary')
  .method('has')
  .method('set')
  .method('append')
  .method('flushHeaders')
  .method('back')
  .access('status')
  .access('message')
  .access('body')
  .access('length')
  .access('type')
  .access('lastModified')
  .access('etag')
  .getter('headerSent')
  .getter('writable')

/**
 * Request delegation.
 */

delegate(proto, 'request')
  .method('acceptsLanguages')
  .method('acceptsEncodings')
  .method('acceptsCharsets')
  .method('accepts')
  .method('get')
  .method('is')
  .access('querystring')
  .access('idempotent')
  .access('socket')
  .access('search')
  .access('method')
  .access('query')
  .access('path')
  .access('url')
  .access('accept')
  .getter('origin')
  .getter('href')
  .getter('subdomains')
  .getter('protocol')
  .getter('host')
  .getter('hostname')
  .getter('URL')
  .getter('header')
  .getter('headers')
  .getter('secure')
  .getter('stale')
  .getter('fresh')
  .getter('ips')
  .getter('ip')

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
