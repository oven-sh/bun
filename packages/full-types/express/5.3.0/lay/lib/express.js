/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 */

var bodyParser = require('body-parser')
var EventEmitter = require('node:events').EventEmitter;
var mixin = require('merge-descriptors');
var proto = require('./application');
var Router = require('router');
var req = require('./request');
var res = require('./response');

/**
 * Expose `createApplication()`.
 */

exports = module.exports = createApplication;

/**
 * Create an express application.
 *
 * @return {Function}
 * @api public
 */

function createApplication() {
  var app = function(req: EX.Request, res: EX.Response, next?: EX.Next) {
    app.handle(req, res, next);
  } as EX.Application;

  mixin(app, EventEmitter.prototype, false);
  mixin(app, proto, false);

  // expose the prototype that will get set on requests
  app.request = Object.create(req, {
    app: { configurable: true, enumerable: true, writable: true, value: app }
  })

  // expose the prototype that will get set on responses
  app.response = Object.create(res, {
    app: { configurable: true, enumerable: true, writable: true, value: app }
  })

  app.init();
  return app;
}

/**
 * Expose the prototypes.
 */

exports.application = proto;
exports.request = req;
exports.response = res;

/**
 * Expose constructors.
 */

exports.Route = Router.Route;
exports.Router = Router;

/**
 * Expose middleware
 */

exports.json = bodyParser.json
exports.raw = bodyParser.raw
exports.static = require('serve-static');
exports.text = bodyParser.text
exports.urlencoded = bodyParser.urlencoded

declare var require: (name: string) => any;
declare var module: { exports: any };
declare var exports: any;
declare namespace EX {
  type Next = (error?: unknown) => void;
  interface Settings { [name: string]: any }
  interface Application {
    (req: Request, res: Response, next?: Next): void;
    cache: { [name: string]: any }; engines: { [extension: string]: Function }; settings: Settings; locals: { [name: string]: any };
    mountpath: string | string[]; parent?: Application; router: any; request: Request; response: Response;
    init(): void; defaultConfiguration(): void; handle(req: Request, res: Response, callback?: Next): void;
    use(...handlers: any[]): Application; route(path: unknown): any; engine(extension: string, fn: Function): Application; param(name: any, fn: Function): Application;
    set(setting: string, value?: any): any; path(): string; enabled(setting: string): boolean; disabled(setting: string): boolean;
    enable(setting: string): Application; disable(setting: string): Application; all(path: unknown, ...handlers: any[]): Application;
    render(name: string, options?: any, callback?: Function): void; listen(...values: any[]): any;
    emit(name: string, ...values: any[]): boolean; on(name: string, listener: Function): Application;
    [method: string]: any;
  }
  interface Request extends import_http_IncomingMessage {
    app: Application; res: Response; next?: Next; baseUrl: string; originalUrl: string; params: { [name: string]: any }; route?: any; body?: unknown;
    get(name: string): string | undefined; header(name: string): string | undefined;
    accepts(...types: any[]): any; acceptsEncodings(...encodings: any[]): any; acceptsCharsets(...charsets: any[]): any; acceptsLanguages(...languages: any[]): any;
    range(size: number, options?: any): any; is(...types: any[]): any;
    readonly query: { [name: string]: any }; readonly protocol: string; readonly secure: boolean; readonly ip: string; readonly ips: string[]; readonly subdomains: string[];
    readonly path: string; readonly host: string | undefined; readonly hostname: string | undefined; readonly fresh: boolean; readonly stale: boolean; readonly xhr: boolean;
  }
  interface Response extends import_http_ServerResponse {
    app: Application; req: Request; locals: { [name: string]: any };
    status(code: number): Response; links(links: { [rel: string]: any }): Response; send(body?: any): Response; json(value?: any): Response; jsonp(value?: any): Response;
    sendStatus(code: number): Response; sendFile(path: string, options?: any, callback?: any): void; download(path: string, filename?: any, options?: any, callback?: any): void;
    contentType(type: string): Response; type(type: string): Response; format(handlers: { [type: string]: any }): Response; attachment(filename?: string): Response;
    append(field: string, value: any): Response; set(field: any, value?: any): Response; header(field: any, value?: any): Response; get(field: string): any;
    clearCookie(name: string, options?: any): Response; cookie(name: string, value: any, options?: any): Response; location(url: string): Response;
    redirect(url: any, ...more: any[]): void; vary(field: any): Response; render(view: string, options?: any, callback?: any): void;
  }
  type import_http_IncomingMessage = import("node:http").IncomingMessage;
  type import_http_ServerResponse = import("node:http").ServerResponse;
}
