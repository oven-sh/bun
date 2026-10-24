'use strict'

const {
  kReplyIsError,
  kReplyHijacked
}: typeof FS = require('./symbols')

const diagnostics = require('node:diagnostics_channel')
const channels = diagnostics.tracingChannel('fastify.request.handler')

function wrapThenable (thenable: any, reply: FY.Reply, store: any) {
  if (store) store.async = true
  thenable.then(function (payload: any) {
    if (reply[kReplyHijacked] === true) {
      return
    }

    if (store) {
      channels.asyncStart.publish(store)
    }

    try {
      // this is for async functions that are using reply.send directly
      //
      // since wrap-thenable will be called when using reply.send directly
      // without actual return. the response can be sent already or
      // the request may be terminated during the reply. in this situation,
      // it require an extra checking of request.aborted to see whether
      // the request is killed by client.
      if (payload !== undefined || //
        (reply.sent === false && //
          reply.raw.headersSent === false &&
          reply.request.raw.aborted === false &&
          reply.request.socket &&
          !reply.request.socket.destroyed
        )
      ) {
        // we use a try-catch internally to avoid adding a catch to another
        // promise, increase promise perf by 10%
        try {
          reply.send(payload)
        } catch (err: any) {
          reply[kReplyIsError] = true
          reply.send(err)
        }
      }
    } finally {
      if (store) {
        channels.asyncEnd.publish(store)
      }
    }
  }, function (err: any) {
    if (store) {
      store.error = err
      channels.error.publish(store) // note that error happens before asyncStart
      channels.asyncStart.publish(store)
    }

    try {
      if (reply.sent === true) {
        reply.log.error({ err }, 'Promise errored, but reply.sent = true was set')
        return
      }

      reply[kReplyIsError] = true

      reply.send(err)
      // The following should not happen
      /* c8 ignore next 3 */
    } catch (err: any) {
      // try-catch allow to re-throw error in error handler for async handler
      reply.send(err)
    } finally {
      if (store) {
        channels.asyncEnd.publish(store)
      }
    }
  })
}

module.exports = wrapThenable

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
