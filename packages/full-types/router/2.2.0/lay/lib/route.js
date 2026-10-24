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

const debug = require('debug')('router:route')
const Layer: RT.LayerConstructor = require('./layer')
const { METHODS } = require('node:http')

/**
 * Module variables.
 * @private
 */

const slice = Array.prototype.slice
const flatten = Array.prototype.flat
const methods: string[] = METHODS.map((method: string) => method.toLowerCase())

/**
 * Expose `Route`.
 */

module.exports = Route

/**
 * Initialize `Route` with the given `path`,
 *
 * @param {String} path
 * @api private
 */

function Route (this: RT.Route, path: unknown) {
  debug('new %o', path)
  this.path = path
  this.stack = []

  // route handlers for various http methods
  this.methods = Object.create(null)
}

/**
 * @private
 */

Route.prototype._handlesMethod = function _handlesMethod (this: RT.Route, method: any): boolean {
  if (this.methods._all) {
    return true
  }

  // normalize name
  let name = typeof method === 'string'
    ? method.toLowerCase()
    : method

  if (name === 'head' && !this.methods.head) {
    name = 'get'
  }

  return Boolean(this.methods[name])
}

/**
 * @return {array} supported HTTP methods
 * @private
 */

Route.prototype._methods = function _methods (this: RT.Route): string[] {
  const methods = Object.keys(this.methods)

  // append automatic head
  if (this.methods.get && !this.methods.head) {
    methods.push('head')
  }

  for (let i = 0; i < methods.length; i++) {
    // make upper case
    methods[i] = methods[i]!.toUpperCase()
  }

  return methods
}

/**
 * dispatch req, res into this route
 *
 * @private
 */

Route.prototype.dispatch = function dispatch (this: RT.Route, req: RT.Request, res: unknown, done: RT.Next) {
  let idx = 0
  const stack = this.stack
  let sync = 0

  if (stack.length === 0) {
    return done()
  }

  let method = typeof req.method === 'string'
    ? req.method.toLowerCase()
    : req.method

  if (method === 'head' && !this.methods.head) {
    method = 'get'
  }

  req.route = this

  next()

  function next (err?: unknown): unknown {
    // signal to exit route
    if (err && err === 'route') {
      return done()
    }

    // signal to exit router
    if (err && err === 'router') {
      return done(err)
    }

    // no more matching layers
    if (idx >= stack.length) {
      return done(err)
    }

    // max sync stack
    if (++sync > 100) {
      return setImmediate(next, err)
    }

    let layer: RT.Layer | undefined
    let match: boolean | undefined

    // find next matching layer
    while (match !== true && idx < stack.length) {
      layer = stack[idx++]!
      match = !layer.method || layer.method === method
    }

    // no match
    if (match !== true) {
      return done(err)
    }

    if (err) {
      layer!.handleError(err, req, res, next)
    } else {
      layer!.handleRequest(req, res, next)
    }

    sync = 0
  }
}

/**
 * Add a handler for all HTTP verbs to this route.
 *
 * Behaves just like middleware and can respond or call `next`
 * to continue processing.
 *
 * You can use multiple `.all` call to add multiple handlers.
 *
 *   function check_something(req, res, next){
 *     next()
 *   }
 *
 *   function validate_user(req, res, next){
 *     next()
 *   }
 *
 *   route
 *   .all(validate_user)
 *   .all(check_something)
 *   .get(function(req, res, next){
 *     res.send('hello world')
 *   })
 *
 * @param {array|function} handler
 * @return {Route} for chaining
 * @api public
 */

Route.prototype.all = function all (this: RT.Route, handler: Function) {
  const callbacks = flatten.call(slice.call(arguments), Infinity)

  if (callbacks.length === 0) {
    throw new TypeError('argument handler is required')
  }

  for (let i = 0; i < callbacks.length; i++) {
    const fn = callbacks[i]

    if (typeof fn !== 'function') {
      throw new TypeError('argument handler must be a function')
    }

    const layer = Layer('/', {}, fn)
    layer.method = undefined

    this.methods._all = true
    this.stack.push(layer)
  }

  return this
}

methods.forEach(function (method: string) {
  Route.prototype[method] = function (this: RT.Route, handler: Function) {
    const callbacks = flatten.call(slice.call(arguments), Infinity)

    if (callbacks.length === 0) {
      throw new TypeError('argument handler is required')
    }

    for (let i = 0; i < callbacks.length; i++) {
      const fn = callbacks[i]

      if (typeof fn !== 'function') {
        throw new TypeError('argument handler must be a function')
      }

      debug('%s %s', method, this.path)

      const layer = Layer('/', {}, fn)
      layer.method = method

      this.methods[method] = true
      this.stack.push(layer)
    }

    return this
  }
})

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
