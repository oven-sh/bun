'use strict'

/**
 * Module dependencies.
 */

const URL = require('url').URL
const net = require('net')
const accepts = require('accepts')
const contentType = require('content-type')
const stringify = require('url').format
const parse = require('parseurl')
const sp = require('./search-params.js')

const typeis = require('type-is')
const fresh = require('fresh')
const only = require('./only.js')
const util = require('util')

const IP = Symbol('context#ip')

/**
 * Prototype.
 */

module.exports = {

  /**
   * Return request header.
   *
   * @return {Object}
   * @api public
   */

  get header () {
    return this.req.headers
  },

  /**
   * Set request header.
   *
   * @api public
   */

  set header (val) {
    this.req.headers = val
  },

  /**
   * Return request header, alias as request.header
   *
   * @return {Object}
   * @api public
   */

  get headers () {
    return this.req.headers
  },

  /**
   * Set request header, alias as request.header
   *
   * @api public
   */

  set headers (val) {
    this.req.headers = val
  },

  /**
   * Get request URL.
   *
   * @return {String}
   * @api public
   */

  get url () {
    return this.req.url
  },

  /**
   * Set request URL.
   *
   * @api public
   */

  set url (val) {
    this.req.url = val
  },

  /**
   * Get the origin header.
   *
   * @return {String}
   * @api public
   */

  get origin () {
    return this.req.headers.origin || null
  },

  /**
   * Get full request URL.
   *
   * @return {String}
   * @api public
   */

  get href () {
    // support: `GET http://example.com/foo`
    if (/^https?:\/\//i.test(this.originalUrl)) return this.originalUrl
    return this.protocol + '://' + this.host + this.originalUrl
  },

  /**
   * Get request method.
   *
   * @return {String}
   * @api public
   */

  get method () {
    return this.req.method
  },

  /**
   * Set request method.
   *
   * @param {String} val
   * @api public
   */

  set method (val) {
    this.req.method = val
  },

  /**
   * Get request pathname.
   *
   * @return {String}
   * @api public
   */

  get path () {
    return parse(this.req).pathname
  },

  /**
   * Set pathname, retaining the query string when present.
   *
   * @param {String} path
   * @api public
   */

  set path (path) {
    const url = parse(this.req)
    if (url.pathname === path) return

    url.pathname = path
    url.path = null

    this.url = stringify(url)
  },

  /**
   * Get parsed query string.
   *
   * @return {Object}
   * @api public
   */

  get query () {
    const str = this.querystring
    const c = this._querycache = this._querycache || {}
    return c[str] || (c[str] = sp.parse(str))
  },

  /**
   * Set query string as an object.
   *
   * @param {Object} obj
   * @api public
   */

  set query (obj) {
    this.querystring = sp.stringify(obj)
  },

  /**
   * Get query string.
   *
   * @return {String}
   * @api public
   */

  get querystring () {
    if (!this.req) return ''
    return parse(this.req).query || ''
  },

  /**
   * Set query string.
   *
   * @param {String} str
   * @api public
   */

  set querystring (str) {
    const url = parse(this.req)
    if (url.search === `?${str}`) return

    url.search = str
    url.path = null
    this.url = stringify(url)
  },

  /**
   * Get the search string. Same as the query string
   * except it includes the leading ?.
   *
   * @return {String}
   * @api public
   */

  get search () {
    if (!this.querystring) return ''
    return `?${this.querystring}`
  },

  /**
   * Set the search string. Same as
   * request.querystring= but included for ubiquity.
   *
   * @param {String} str
   * @api public
   */

  set search (str) {
    this.querystring = str
  },

  /**
   * Parse the "Host" header field host
   * and support X-Forwarded-Host when a
   * proxy is enabled.
   *
   * @return {String} hostname:port
   * @api public
   */

  get host () {
    const proxy = this.app.proxy
    let host = proxy && this.get('X-Forwarded-Host')
    if (!host) {
      if (this.req.httpVersionMajor >= 2) host = this.get(':authority')
      if (!host) host = this.get('Host')
    }
    if (!host) return ''
    host = splitCommaSeparatedValues(host, 1)[0]!
    // Host header may contain userinfo (e.g., "user@host") which is invalid per RFC 7230.
    // Use URL parser to correctly extract the host portion.
    if (host.includes('@')) {
      try {
        host = new URL(`http://${host}`).host
      } catch (e) {
        return ''
      }
    }
    return host
  },

  /**
   * Parse the "Host" header field hostname
   * and support X-Forwarded-Host when a
   * proxy is enabled.
   *
   * @return {String} hostname
   * @api public
   */

  get hostname () {
    const host = this.host
    if (!host) return ''
    if (host[0] === '[') return this.URL.hostname || '' // IPv6
    return host.split(':', 1)[0]
  },

  /**
   * Get WHATWG parsed URL.
   * Lazily memoized.
   *
   * @return {URL|Object}
   * @api public
   */

  get URL () {
    /* istanbul ignore else */
    if (!this.memoizedURL) {
      const originalUrl = this.originalUrl || '' // avoid undefined in template string
      try {
        this.memoizedURL = new URL(`${this.protocol}://${this.host}${originalUrl}`)
      } catch (err) {
        this.memoizedURL = Object.create(null)
      }
    }
    return this.memoizedURL
  },

  /**
   * Check if the request is fresh, aka
   * Last-Modified and/or the ETag
   * still match.
   *
   * @return {Boolean}
   * @api public
   */

  get fresh () {
    const method = this.method
    const s = this.ctx.status

    // GET or HEAD for weak freshness validation only
    if (method !== 'GET' && method !== 'HEAD') return false

    // 2xx or 304 as per rfc2616 14.26
    if ((s >= 200 && s < 300) || s === 304) {
      return fresh(this.header, this.response.header)
    }

    return false
  },

  /**
   * Check if the request is stale, aka
   * "Last-Modified" and / or the "ETag" for the
   * resource has changed.
   *
   * @return {Boolean}
   * @api public
   */

  get stale () {
    return !this.fresh
  },

  /**
   * Check if the request is idempotent.
   *
   * @return {Boolean}
   * @api public
   */

  get idempotent () {
    const methods = ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']
    return !!~methods.indexOf(this.method)
  },

  /**
   * Return the request socket.
   *
   * @return {Connection}
   * @api public
   */

  get socket () {
    return this.req.socket
  },

  /**
   * Get the charset when present or undefined.
   *
   * @return {String}
   * @api public
   */

  get charset () {
    try {
      const { parameters } = contentType.parse(this.req)
      return parameters.charset || ''
    } catch (e) {
      return ''
    }
  },

  /**
   * Return parsed Content-Length when present.
   *
   * @return {Number|void}
   * @api public
   */

  get length () {
    const len = this.get('Content-Length')
    if (len === '') return
    const parsed = Number.parseInt(len, 10)
    return Number.isNaN(parsed) ? undefined : parsed
  },

  /**
   * Return the protocol string "http" or "https"
   * when requested with TLS. When the proxy setting
   * is enabled the "X-Forwarded-Proto" header
   * field will be trusted. If you're running behind
   * a reverse proxy that supplies https for you this
   * may be enabled.
   *
   * @return {String}
   * @api public
   */

  get protocol () {
    if (this.socket.encrypted) return 'https'
    if (!this.app.proxy) return 'http'
    const proto = this.get('X-Forwarded-Proto')
    return proto ? splitCommaSeparatedValues(proto, 1)[0] : 'http'
  },

  /**
   * Shorthand for:
   *
   *    this.protocol == 'https'
   *
   * @return {Boolean}
   * @api public
   */

  get secure () {
    return this.protocol === 'https'
  },

  /**
   * When `app.proxy` is `true`, parse
   * the "X-Forwarded-For" ip address list.
   *
   * For example if the value was "client, proxy1, proxy2"
   * you would receive the array `["client", "proxy1", "proxy2"]`
   * where "proxy2" is the furthest down-stream.
   *
   * @return {Array}
   * @api public
   */

  get ips () {
    const proxy = this.app.proxy
    const val = this.get(this.app.proxyIpHeader)
    let ips = proxy && val
      ? splitCommaSeparatedValues(val)
      : []
    if (this.app.maxIpsCount > 0) {
      ips = ips.slice(-this.app.maxIpsCount)
    }
    return ips
  },

  /**
   * Return request's remote address
   * When `app.proxy` is `true`, parse
   * the "X-Forwarded-For" ip address list and return the first one
   *
   * @return {String}
   * @api public
   */

  get ip () {
    if (!this[IP]) {
      this[IP] = this.ips[0] || this.socket.remoteAddress || ''
    }
    return this[IP]
  },

  set ip (_ip) {
    this[IP] = _ip
  },

  /**
   * Return subdomains as an array.
   *
   * Subdomains are the dot-separated parts of the host before the main domain
   * of the app. By default, the domain of the app is assumed to be the last two
   * parts of the host. This can be changed by setting `app.subdomainOffset`.
   *
   * For example, if the domain is "tobi.ferrets.example.com":
   * If `app.subdomainOffset` is not set, this.subdomains is
   * `["ferrets", "tobi"]`.
   * If `app.subdomainOffset` is 3, this.subdomains is `["tobi"]`.
   *
   * @return {Array}
   * @api public
   */

  get subdomains () {
    const offset = this.app.subdomainOffset
    const hostname = this.hostname
    if (net.isIP(hostname)) return []
    return hostname
      .split('.')
      .reverse()
      .slice(offset)
  },

  /**
   * Get accept object.
   * Lazily memoized.
   *
   * @return {Object}
   * @api private
   */

  get accept () {
    return this._accept || (this._accept = accepts(this.req))
  },

  /**
   * Set accept object.
   *
   * @param {Object} obj
   * @api private
   */

  set accept (obj) {
    this._accept = obj
  },

  /**
   * Check if the given `type(s)` is acceptable, returning
   * the best match when true, otherwise `false`, in which
   * case you should respond with 406 "Not Acceptable".
   *
   * The `type` value may be a single mime type string
   * such as "application/json", the extension name
   * such as "json" or an array `["json", "html", "text/plain"]`. When a list
   * or array is given the _best_ match, if any is returned.
   *
   * Examples:
   *
   *     // Accept: text/html
   *     this.accepts('html');
   *     // => "html"
   *
   *     // Accept: text/*, application/json
   *     this.accepts('html');
   *     // => "html"
   *     this.accepts('text/html');
   *     // => "text/html"
   *     this.accepts('json', 'text');
   *     // => "json"
   *     this.accepts('application/json');
   *     // => "application/json"
   *
   *     // Accept: text/*, application/json
   *     this.accepts('image/png');
   *     this.accepts('png');
   *     // => false
   *
   *     // Accept: text/*;q=.5, application/json
   *     this.accepts(['html', 'json']);
   *     this.accepts('html', 'json');
   *     // => "json"
   *
   * @param {String|Array} type(s)...
   * @return {String|Array|false}
   * @api public
   */

  accepts (...args: any[]) {
    return this.accept.types(...args)
  },

  /**
   * Return accepted encodings or best fit based on `encodings`.
   *
   * Given `Accept-Encoding: gzip, deflate`
   * an array sorted by quality is returned:
   *
   *     ['gzip', 'deflate']
   *
   * @param {String|Array} encoding(s)...
   * @return {String|Array}
   * @api public
   */

  acceptsEncodings (...args: any[]) {
    return this.accept.encodings(...args)
  },

  /**
   * Return accepted charsets or best fit based on `charsets`.
   *
   * Given `Accept-Charset: utf-8, iso-8859-1;q=0.2, utf-7;q=0.5`
   * an array sorted by quality is returned:
   *
   *     ['utf-8', 'utf-7', 'iso-8859-1']
   *
   * @param {String|Array} charset(s)...
   * @return {String|Array}
   * @api public
   */

  acceptsCharsets (...args: any[]) {
    return this.accept.charsets(...args)
  },

  /**
   * Return accepted languages or best fit based on `langs`.
   *
   * Given `Accept-Language: en;q=0.8, es, pt`
   * an array sorted by quality is returned:
   *
   *     ['es', 'pt', 'en']
   *
   * @param {String|Array} lang(s)...
   * @return {Array|String}
   * @api public
   */

  acceptsLanguages (...args: any[]) {
    return this.accept.languages(...args)
  },

  /**
   * Check if the incoming request contains the "Content-Type"
   * header field and if it contains any of the given mime `type`s.
   * If there is no request body, `null` is returned.
   * If there is no content type, `false` is returned.
   * Otherwise, it returns the first `type` that matches.
   *
   * Examples:
   *
   *     // With Content-Type: text/html; charset=utf-8
   *     this.is('html'); // => 'html'
   *     this.is('text/html'); // => 'text/html'
   *     this.is('text/*', 'application/json'); // => 'text/html'
   *
   *     // When Content-Type is application/json
   *     this.is('json', 'urlencoded'); // => 'json'
   *     this.is('application/json'); // => 'application/json'
   *     this.is('html', 'application/*'); // => 'application/json'
   *
   *     this.is('html'); // => false
   *
   * @param {String|String[]} [type]
   * @param {String[]} [types]
   * @return {String|false|null}
   * @api public
   */

  is (type: any, ...types: any[]) {
    return typeis(this.req, type, ...types)
  },

  /**
   * Return the request mime type void of
   * parameters such as "charset".
   *
   * @return {String}
   * @api public
   */

  get type () {
    const type = this.get('Content-Type')
    if (!type) return ''
    return type.split(';')[0]
  },

  /**
   * Return request header.
   *
   * The `Referrer` header field is special-cased,
   * both `Referrer` and `Referer` are interchangeable.
   *
   * Examples:
   *
   *     this.get('Content-Type');
   *     // => "text/plain"
   *
   *     this.get('content-type');
   *     // => "text/plain"
   *
   *     this.get('Something');
   *     // => ''
   *
   * @param {String} field
   * @return {String}
   * @api public
   */

  get (field: string): string {
    const req = this.req
    switch (field = field.toLowerCase()) {
      case 'referer':
      case 'referrer':
        return (req.headers.referrer || req.headers.referer || '') as string
      default:
        return (req.headers[field] || '') as string
    }
  },

  /**
   * Inspect implementation.
   *
   * @return {Object}
   * @api public
   */

  inspect () {
    if (!this.req) return
    return this.toJSON()
  },

  /**
   * Return JSON representation.
   *
   * @return {Object}
   * @api public
   */

  toJSON () {
    return only(this, [
      'method',
      'url',
      'header'
    ])
  }
} satisfies ThisType<KT.Request & { [IP]?: string }>

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
 * Split a comma-separated value string into an array of values, with an optional limit.
 * All the values are trimmed of whitespace.
 *
 * @param {string} value - The comma-separated value string to split.
 * @param {number} [limit] - The maximum number of values to return.
 * @returns {string[]} An array of values from the comma-separated string.
 */
function splitCommaSeparatedValues (value: string, limit?: number): string[] {
  return value.split(',', limit).map(v => v.trim())
}

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
