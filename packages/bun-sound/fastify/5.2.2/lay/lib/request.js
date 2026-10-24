'use strict'

const proxyAddr = require('@fastify/proxy-addr')
const {
  kHasBeenDecorated,
  kSchemaBody,
  kSchemaHeaders,
  kSchemaParams,
  kSchemaQuerystring,
  kSchemaController,
  kOptions,
  kRequestCacheValidateFns,
  kRouteContext,
  kRequestOriginalUrl
}: typeof FS = require('./symbols')
const { FST_ERR_REQ_INVALID_VALIDATION_INVOCATION } = require('./errors')

const HTTP_PART_SYMBOL_MAP: { [part: string]: keyof FY.Context } = {
  body: kSchemaBody,
  headers: kSchemaHeaders,
  params: kSchemaParams,
  querystring: kSchemaQuerystring,
  query: kSchemaQuerystring
}

function Request (this: FY.Request, id: unknown, params: unknown, req: FY.Incoming, query: unknown, log: any, context: FY.Context) {
  this.id = id
  this[kRouteContext] = context
  this.params = params
  this.raw = req
  this.query = query
  this.log = log
  this.body = undefined
}
Request.props = [] as FY.Decoration[]

function getTrustProxyFn (tp: any) {
  if (typeof tp === 'function') {
    return tp
  }
  if (tp === true) {
    // Support trusting everything
    return null
  }
  if (typeof tp === 'number') {
    // Support trusting hop count
    return function (a: any, i: any) { return i < tp }
  }
  if (typeof tp === 'string') {
    // Support comma-separated tps
    const values = tp.split(',').map(it => it.trim())
    return proxyAddr.compile(values)
  }
  return proxyAddr.compile(tp)
}

function buildRequest (R: any, trustProxy: any) {
  if (trustProxy) {
    return buildRequestWithTrustProxy(R, trustProxy)
  }

  return buildRegularRequest(R)
}

function buildRegularRequest (R: FY.RequestConstructor) {
  const props = R.props.slice()
  function _Request (this: FY.Request, id: unknown, params: unknown, req: FY.Incoming, query: unknown, log: any, context: FY.Context) {
    this.id = id
    this[kRouteContext] = context
    this.params = params
    this.raw = req
    this.query = query
    this.log = log
    this.body = undefined

    let prop
    for (let i = 0; i < props.length; i++) {
      prop = props[i]
      ;(this as any)[prop!.key] = prop!.value
    }
  }
  Object.setPrototypeOf(_Request.prototype, R.prototype)
  Object.setPrototypeOf(_Request, R)
  _Request.props = props
  _Request.parent = R

  return _Request
}

function getLastEntryInMultiHeaderValue (headerValue: any) {
  // we use the last one if the header is set more than once
  const lastIndex = headerValue.lastIndexOf(',')
  return lastIndex === -1 ? headerValue.trim() : headerValue.slice(lastIndex + 1).trim()
}

function buildRequestWithTrustProxy (R: any, trustProxy: any) {
  const _Request = buildRegularRequest(R)
  const proxyFn = getTrustProxyFn(trustProxy)

  // This is a more optimized version of decoration
  ;(_Request as any)[kHasBeenDecorated] = true

  Object.defineProperties(_Request.prototype, {
    ip: {
      get () {
        const addrs = proxyAddr.all(this.raw, proxyFn)
        return addrs[addrs.length - 1]
      }
    },
    ips: {
      get () {
        return proxyAddr.all(this.raw, proxyFn)
      }
    },
    host: {
      get () {
        if (this.ip !== undefined && this.headers['x-forwarded-host']) {
          return getLastEntryInMultiHeaderValue(this.headers['x-forwarded-host'])
        }
        /**
         * The last fallback supports the following cases:
         * 1. http.requireHostHeader === false
         * 2. HTTP/1.0 without a Host Header
         * 3. Headers schema that may remove the Host Header
         */
        return this.headers.host ?? this.headers[':authority'] ?? ''
      }
    },
    protocol: {
      get () {
        if (this.headers['x-forwarded-proto']) {
          return getLastEntryInMultiHeaderValue(this.headers['x-forwarded-proto'])
        }
        if (this.socket) {
          return this.socket.encrypted ? 'https' : 'http'
        }
      }
    }
  })

  return _Request
}

Object.defineProperties(Request.prototype, {
  server: {
    get () {
      return this[kRouteContext].server
    }
  },
  url: {
    get () {
      return this.raw.url
    }
  },
  originalUrl: {
    get () {
      /* istanbul ignore else */
      if (!this[kRequestOriginalUrl]) {
        this[kRequestOriginalUrl] = this.raw.originalUrl || this.raw.url
      }
      return this[kRequestOriginalUrl]
    }
  },
  method: {
    get () {
      return this.raw.method
    }
  },
  routeOptions: {
    get () {
      const context = this[kRouteContext]
      const routeLimit = context._parserOptions.limit
      const serverLimit = context.server.initialConfig.bodyLimit
      const version = context.server.hasConstraintStrategy('version') ? this.raw.headers['accept-version'] : undefined
      const options = {
        method: context.config?.method,
        url: context.config?.url,
        bodyLimit: (routeLimit || serverLimit),
        attachValidation: context.attachValidation,
        logLevel: context.logLevel,
        exposeHeadRoute: context.exposeHeadRoute,
        prefixTrailingSlash: context.prefixTrailingSlash,
        handler: context.handler,
        version
      }

      Object.defineProperties(options, {
        config: {
          get: () => context.config
        },
        schema: {
          get: () => context.schema
        }
      })

      return Object.freeze(options)
    }
  },
  is404: {
    get () {
      return this[kRouteContext].config?.url === undefined
    }
  },
  socket: {
    get () {
      return this.raw.socket
    }
  },
  ip: {
    get () {
      if (this.socket) {
        return this.socket.remoteAddress
      }
    }
  },
  host: {
    get () {
      /**
       * The last fallback supports the following cases:
       * 1. http.requireHostHeader === false
       * 2. HTTP/1.0 without a Host Header
       * 3. Headers schema that may remove the Host Header
       */
      return this.raw.headers.host ?? this.raw.headers[':authority'] ?? ''
    }
  },
  hostname: {
    get () {
      return this.host.split(':', 1)[0]
    }
  },
  port: {
    get () {
      // first try taking port from host
      const portFromHost = parseInt(this.host.split(':').slice(-1)[0])
      if (!isNaN(portFromHost)) {
        return portFromHost
      }
      // now fall back to port from host/:authority header
      const host = (this.headers.host ?? this.headers[':authority'] ?? '')
      const portFromHeader = parseInt(host.split(':').slice(-1)[0])
      if (!isNaN(portFromHeader)) {
        return portFromHeader
      }
      // fall back to null
      return null
    }
  },
  protocol: {
    get () {
      if (this.socket) {
        return this.socket.encrypted ? 'https' : 'http'
      }
    }
  },
  headers: {
    get () {
      if (this.additionalHeaders) {
        return Object.assign({}, this.raw.headers, this.additionalHeaders)
      }
      return this.raw.headers
    },
    set (headers) {
      this.additionalHeaders = headers
    }
  },
  getValidationFunction: {
    value: function (httpPartOrSchema: any) {
      if (typeof httpPartOrSchema === 'string') {
        const symbol = HTTP_PART_SYMBOL_MAP[httpPartOrSchema]
        return this[kRouteContext][symbol!]
      } else if (typeof httpPartOrSchema === 'object') {
        return this[kRouteContext][kRequestCacheValidateFns]?.get(httpPartOrSchema)
      }
    }
  },
  compileValidationSchema: {
    value: function (schema: any, httpPart = null) {
      const { method, url } = this

      if (this[kRouteContext][kRequestCacheValidateFns]?.has(schema)) {
        return this[kRouteContext][kRequestCacheValidateFns].get(schema)
      }

      const validatorCompiler = this[kRouteContext].validatorCompiler ||
        this.server[kSchemaController].validatorCompiler ||
        (
          // We compile the schemas if no custom validatorCompiler is provided
          // nor set
          this.server[kSchemaController].setupValidator(this.server[kOptions]) ||
          this.server[kSchemaController].validatorCompiler
        )

      const validateFn = validatorCompiler({
        schema,
        method,
        url,
        httpPart
      })

      // We create a WeakMap to compile the schema only once
      // Its done lazily to avoid add overhead by creating the WeakMap
      // if it is not used
      // TODO: Explore a central cache for all the schemas shared across
      // encapsulated contexts
      if (this[kRouteContext][kRequestCacheValidateFns] == null) {
        this[kRouteContext][kRequestCacheValidateFns] = new WeakMap()
      }

      this[kRouteContext][kRequestCacheValidateFns].set(schema, validateFn)

      return validateFn
    }
  },
  validateInput: {
    value: function (input: any, schema: any, httpPart: any) {
      httpPart = typeof schema === 'string' ? schema : httpPart

      const symbol = (httpPart != null && typeof httpPart === 'string') && HTTP_PART_SYMBOL_MAP[httpPart]
      let validate

      if (symbol) {
        // Validate using the HTTP Request Part schema
        validate = this[kRouteContext][symbol]
      }

      // We cannot compile if the schema is missed
      if (validate == null && (schema == null ||
        typeof schema !== 'object' ||
        Array.isArray(schema))
      ) {
        throw new FST_ERR_REQ_INVALID_VALIDATION_INVOCATION(httpPart)
      }

      if (validate == null) {
        if (this[kRouteContext][kRequestCacheValidateFns]?.has(schema)) {
          validate = this[kRouteContext][kRequestCacheValidateFns].get(schema)
        } else {
          // We proceed to compile if there's no validate function yet
          validate = this.compileValidationSchema(schema, httpPart)
        }
      }

      return validate(input)
    }
  }
})

module.exports = Request
module.exports.buildRequest = buildRequest

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
