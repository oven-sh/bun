/*!
 * router
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2022 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict'

/**
 * Module dependencies.
 * @private
 */

const isPromise = require('is-promise')
const pathRegexp = require('path-to-regexp')
const debug = require('debug')('router:layer')
const deprecate = require('depd')('router')

/**
 * Module variables.
 * @private
 */

const TRAILING_SLASH_REGEXP = /\/+$/
const MATCHING_GROUP_REGEXP = /\((?:\?<(.*?)>)?(?!\?)/g

/**
 * Expose `Layer`.
 */

module.exports = Layer

function Layer (this: RT.Layer | void, path: any, options: RT.LayerOptions | undefined, fn: Function): RT.Layer | void {
  if (!(this instanceof Layer)) {
    return new (Layer as unknown as RT.LayerConstructor)(path, options!, fn)
  }

  debug('new %o', path)
  const opts = options || {}

  this.handle = fn
  this.keys = []
  this.name = fn.name || '<anonymous>'
  this.params = undefined
  this.path = undefined
  this.slash = path === '/' && opts.end === false

  function matcher (_path: any): RT.Matcher {
    if (_path instanceof RegExp) {
      const keys: { name: string | number, offset: number }[] = []
      let name = 0
      let m
      // eslint-disable-next-line no-cond-assign
      while (m = MATCHING_GROUP_REGEXP.exec(_path.source)) {
        keys.push({
          name: m[1] || name++,
          offset: m.index
        })
      }

      return function regexpMatcher (p: string) {
        const match = _path.exec(p)
        if (!match) {
          return false
        }

        const params: RT.Parameters = {}
        for (let i = 1; i < match.length; i++) {
          const key = keys[i - 1]!
          const prop = key.name
          const val = decodeParam(match[i])

          if (val !== undefined) {
            params[prop] = val
          }
        }

        return {
          params,
          path: match[0]
        }
      }
    }

    return pathRegexp.match((opts.strict ? _path : loosen(_path)), {
      sensitive: opts.sensitive,
      end: opts.end,
      trailing: !opts.strict,
      decode: decodeParam
    })
  }
  this.matchers = Array.isArray(path) ? path.map(matcher) : [matcher(path)]
}

/**
 * Handle the error for the layer.
 *
 * @param {Error} error
 * @param {Request} req
 * @param {Response} res
 * @param {function} next
 * @api private
 */

Layer.prototype.handleError = function handleError (this: RT.Layer, error: unknown, req: RT.Request, res: unknown, next: RT.Next) {
  const fn = this.handle

  if (fn.length !== 4) {
    // not a standard error handler
    return next(error)
  }

  try {
    // invoke function
    const ret = fn(error, req, res, next)

    // wait for returned promise
    if (isPromise(ret)) {
      if (!(ret instanceof Promise)) {
        deprecate('handlers that are Promise-like are deprecated, use a native Promise instead')
      }

      ret.then(null, function (error: any) {
        next(error || new Error('Rejected promise'))
      })
    }
  } catch (err) {
    next(err)
  }
}

/**
 * Handle the request for the layer.
 *
 * @param {Request} req
 * @param {Response} res
 * @param {function} next
 * @api private
 */

Layer.prototype.handleRequest = function handleRequest (this: RT.Layer, req: RT.Request, res: unknown, next: RT.Next) {
  const fn = this.handle

  if (fn.length > 3) {
    // not a standard request handler
    return next()
  }

  try {
    // invoke function
    const ret = fn(req, res, next)

    // wait for returned promise
    if (isPromise(ret)) {
      if (!(ret instanceof Promise)) {
        deprecate('handlers that are Promise-like are deprecated, use a native Promise instead')
      }

      ret.then(null, function (error: any) {
        next(error || new Error('Rejected promise'))
      })
    }
  } catch (err) {
    next(err)
  }
}

/**
 * Check if this route matches `path`, if so
 * populate `.params`.
 *
 * @param {String} path
 * @return {Boolean}
 * @api private
 */

Layer.prototype.match = function match (this: RT.Layer, path: string | null | undefined): boolean {
  let match: RT.Match | false | undefined

  if (path != null) {
    // fast path non-ending match for / (any path matches)
    if (this.slash) {
      this.params = {}
      this.path = ''
      return true
    }

    let i = 0
    while (!match && i < this.matchers.length) {
      // match the path
      match = this.matchers[i]!(path)
      i++
    }
  }

  if (!match) {
    this.params = undefined
    this.path = undefined
    return false
  }

  // store values
  this.params = match.params
  this.path = match.path
  this.keys = Object.keys(match.params)

  return true
}

/**
 * Decode param value.
 *
 * @param {string} val
 * @return {string}
 * @private
 */

function decodeParam (val: any) {
  if (typeof val !== 'string' || val.length === 0) {
    return val
  }

  try {
    return decodeURIComponent(val)
  } catch (err) {
    if (err instanceof URIError) {
      err.message = 'Failed to decode param \'' + val + '\''
      ;(err as any).status = 400
    }

    throw err
  }
}

/**
 * Loosens the given path for path-to-regexp matching.
 */
function loosen (path: any): any {
  if (path instanceof RegExp || path === '/') {
    return path
  }

  return Array.isArray(path)
    ? path.map(function (p: any) { return loosen(p) })
    : String(path).replace(TRAILING_SLASH_REGEXP, '')
}

declare var require: (name: string) => any;
declare var module: { exports: any };
declare var exports: any;
declare namespace RT {
  type Next = (error?: unknown) => void;
  interface Parameters { [name: string]: any }
  interface Match { params: Parameters; path: string }
  type Matcher = (path: string) => Match | false;
  interface Layer {
    handle: Function; keys: string[]; name: string; params: Parameters | undefined; path: string | undefined; slash: boolean; matchers: Matcher[];
    method?: string; route?: Route;
    handleError(error: unknown, req: Request, res: unknown, next: Next): void;
    handleRequest(req: Request, res: unknown, next: Next): void;
    match(path: string | null | undefined): boolean;
  }
  type LayerConstructor = { (path: unknown, options: LayerOptions, fn: Function): Layer; new (path: unknown, options: LayerOptions, fn: Function): Layer };
  interface LayerOptions { sensitive?: boolean; strict?: boolean; end?: boolean }
  interface Route {
    path: unknown; stack: Layer[]; methods: { [method: string]: boolean | undefined };
    _handlesMethod(method: unknown): boolean; _methods(): string[];
    dispatch(req: Request, res: unknown, done: Next): void;
    [method: string]: any;
  }
  interface Request {
    method?: string; url?: string; route?: Route; baseUrl?: string; originalUrl?: string; params?: Parameters; next?: Next;
  }
}
