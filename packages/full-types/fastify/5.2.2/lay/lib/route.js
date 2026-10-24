'use strict'

const FindMyWay = require('find-my-way')
const Context = require('./context')
const handleRequest = require('./handleRequest')
const { onRequestAbortHookRunner, lifecycleHooks, preParsingHookRunner, onTimeoutHookRunner, onRequestHookRunner } = require('./hooks')
const { normalizeSchema } = require('./schemas')
const { parseHeadOnSendHandlers } = require('./headRoute')

const {
  compileSchemasForValidation,
  compileSchemasForSerialization
} = require('./validation')

const {
  FST_ERR_SCH_VALIDATION_BUILD,
  FST_ERR_SCH_SERIALIZATION_BUILD,
  FST_ERR_DUPLICATED_ROUTE,
  FST_ERR_INVALID_URL,
  FST_ERR_HOOK_INVALID_HANDLER,
  FST_ERR_ROUTE_OPTIONS_NOT_OBJ,
  FST_ERR_ROUTE_DUPLICATED_HANDLER,
  FST_ERR_ROUTE_HANDLER_NOT_FN,
  FST_ERR_ROUTE_MISSING_HANDLER,
  FST_ERR_ROUTE_METHOD_NOT_SUPPORTED,
  FST_ERR_ROUTE_METHOD_INVALID,
  FST_ERR_ROUTE_BODY_VALIDATION_SCHEMA_NOT_SUPPORTED,
  FST_ERR_ROUTE_BODY_LIMIT_OPTION_NOT_INT,
  FST_ERR_HOOK_INVALID_ASYNC_HANDLER
} = require('./errors')

const {
  kRoutePrefix,
  kSupportedHTTPMethods,
  kLogLevel,
  kLogSerializers,
  kHooks,
  kSchemaController,
  kOptions,
  kReplySerializerDefault,
  kReplyIsError,
  kRequestPayloadStream,
  kDisableRequestLogging,
  kSchemaErrorFormatter,
  kErrorHandler,
  kHasBeenDecorated,
  kRequestAcceptVersion,
  kRouteByFastify,
  kRouteContext
}: typeof FS = require('./symbols.js')
const { buildErrorHandler } = require('./error-handler')
const { createChildLogger } = require('./logger-factory.js')
const { getGenReqId } = require('./reqIdGenFactory.js')

function buildRouting (options: any) {
  const router = FindMyWay(options.config)

  let avvio: any
  let fourOhFour: any
  let logger: any
  let hasLogger: any
  let setupResponseListeners: any
  let throwIfAlreadyStarted: any
  let disableRequestLogging: any
  let ignoreTrailingSlash: any
  let ignoreDuplicateSlashes: any
  let return503OnClosing: any
  let globalExposeHeadRoutes: any
  let keepAliveConnections: any

  let closing = false

  return {
    /**
     * @param {import('../fastify').FastifyServerOptions} options
     * @param {*} fastifyArgs
     */
    setup (options: any, fastifyArgs: any) {
      avvio = fastifyArgs.avvio
      fourOhFour = fastifyArgs.fourOhFour
      logger = fastifyArgs.logger
      hasLogger = fastifyArgs.hasLogger
      setupResponseListeners = fastifyArgs.setupResponseListeners
      throwIfAlreadyStarted = fastifyArgs.throwIfAlreadyStarted

      globalExposeHeadRoutes = options.exposeHeadRoutes
      disableRequestLogging = options.disableRequestLogging
      ignoreTrailingSlash = options.ignoreTrailingSlash
      ignoreDuplicateSlashes = options.ignoreDuplicateSlashes
      return503OnClosing = Object.hasOwn(options, 'return503OnClosing') ? options.return503OnClosing : true
      keepAliveConnections = fastifyArgs.keepAliveConnections
    },
    routing: router.lookup.bind(router), // router func to find the right handler to call
    route, // configure a route in the fastify instance
    hasRoute,
    prepareRoute,
    routeHandler,
    closeRoutes: () => { closing = true },
    printRoutes: router.prettyPrint.bind(router),
    addConstraintStrategy,
    hasConstraintStrategy,
    isAsyncConstraint,
    findRoute
  }

  function addConstraintStrategy (strategy: any) {
    throwIfAlreadyStarted('Cannot add constraint strategy!')
    return router.addConstraintStrategy(strategy)
  }

  function hasConstraintStrategy (strategyName: any) {
    return router.hasConstraintStrategy(strategyName)
  }

  function isAsyncConstraint () {
    return router.constrainer.asyncStrategiesInUse.size > 0
  }

  // Convert shorthand to extended route declaration
  function prepareRoute (this: any, { method, url, options, handler, isFastify }: any) {
    if (typeof url !== 'string') {
      throw new FST_ERR_INVALID_URL(typeof url)
    }

    if (!handler && typeof options === 'function') {
      handler = options // for support over direct function calls such as fastify.get() options are reused as the handler
      options = {}
    } else if (handler && typeof handler === 'function') {
      if (Object.prototype.toString.call(options) !== '[object Object]') {
        throw new FST_ERR_ROUTE_OPTIONS_NOT_OBJ(method, url)
      } else if (options.handler) {
        if (typeof options.handler === 'function') {
          throw new FST_ERR_ROUTE_DUPLICATED_HANDLER(method, url)
        } else {
          throw new FST_ERR_ROUTE_HANDLER_NOT_FN(method, url)
        }
      }
    }

    options = Object.assign({}, options, {
      method,
      url,
      path: url,
      handler: handler || (options && options.handler)
    })

    return route.call(this, { options, isFastify })
  }

  function hasRoute ({ options }: any) {
    const normalizedMethod = options.method?.toUpperCase() ?? ''
    return router.hasRoute(
      normalizedMethod,
      options.url || '',
      options.constraints
    )
  }

  function findRoute (options: any) {
    const route = router.find(
      options.method,
      options.url || '',
      options.constraints
    )
    if (route) {
      // we must reduce the expose surface, otherwise
      // we provide the ability for the user to modify
      // all the route and server information in runtime
      return {
        handler: route.handler,
        params: route.params,
        searchParams: route.searchParams
      }
    } else {
      return null
    }
  }

  /**
   * Route management
   * @param {{ options: import('../fastify').RouteOptions, isFastify: boolean }}
   */
  function route (this: any, { options, isFastify }: any) {
    throwIfAlreadyStarted('Cannot add route!')

    // Since we are mutating/assigning only top level props, it is fine to have a shallow copy using the spread operator
    const opts = { ...options }

    const path = opts.url || opts.path || ''

    if (!opts.handler) {
      throw new FST_ERR_ROUTE_MISSING_HANDLER(opts.method, path)
    }

    if (opts.errorHandler !== undefined && typeof opts.errorHandler !== 'function') {
      throw new FST_ERR_ROUTE_HANDLER_NOT_FN(opts.method, path)
    }

    validateBodyLimitOption(opts.bodyLimit)

    const shouldExposeHead = opts.exposeHeadRoute ?? globalExposeHeadRoutes

    let isGetRoute = false
    let isHeadRoute = false

    if (Array.isArray(opts.method)) {
      for (let i = 0; i < opts.method.length; ++i) {
        opts.method[i] = normalizeAndValidateMethod.call(this, opts.method[i])
        validateSchemaBodyOption.call(this, opts.method[i], path, opts.schema)

        isGetRoute = opts.method.includes('GET')
        isHeadRoute = opts.method.includes('HEAD')
      }
    } else {
      opts.method = normalizeAndValidateMethod.call(this, opts.method)
      validateSchemaBodyOption.call(this, opts.method, path, opts.schema)

      isGetRoute = opts.method === 'GET'
      isHeadRoute = opts.method === 'HEAD'
    }

    // we need to clone a set of initial options for HEAD route
    const headOpts = shouldExposeHead && isGetRoute ? { ...options } : null

    const prefix = this[kRoutePrefix]

    if (path === '/' && prefix.length > 0 && opts.method !== 'HEAD') {
      switch (opts.prefixTrailingSlash) {
        case 'slash':
          addNewRoute.call(this, { path, isFastify })
          break
        case 'no-slash':
          addNewRoute.call(this, { path: '', isFastify })
          break
        case 'both':
        default:
          addNewRoute.call(this, { path: '', isFastify })
          // If ignoreTrailingSlash is set to true we need to add only the '' route to prevent adding an incomplete one.
          if (ignoreTrailingSlash !== true && (ignoreDuplicateSlashes !== true || !prefix.endsWith('/'))) {
            addNewRoute.call(this, { path, prefixing: true, isFastify })
          }
      }
    } else if (path[0] === '/' && prefix.endsWith('/')) {
      // Ensure that '/prefix/' + '/route' gets registered as '/prefix/route'
      addNewRoute.call(this, { path: path.slice(1), isFastify })
    } else {
      addNewRoute.call(this, { path, isFastify })
    }

    // chainable api
    return this

    function addNewRoute (this: any, { path, prefixing = false, isFastify = false }: any) {
      const url = prefix + path

      opts.url = url
      opts.path = url
      opts.routePath = path
      opts.prefix = prefix
      opts.logLevel = opts.logLevel || this[kLogLevel]

      if (this[kLogSerializers] || opts.logSerializers) {
        opts.logSerializers = Object.assign(Object.create(this[kLogSerializers]), opts.logSerializers)
      }

      if (opts.attachValidation == null) {
        opts.attachValidation = false
      }

      if (prefixing === false) {
        // run 'onRoute' hooks
        for (const hook of this[kHooks].onRoute) {
          hook.call(this, opts)
        }
      }

      for (const hook of lifecycleHooks) {
        if (opts && hook in opts) {
          if (Array.isArray(opts[hook])) {
            for (const func of opts[hook]) {
              if (typeof func !== 'function') {
                throw new FST_ERR_HOOK_INVALID_HANDLER(hook, Object.prototype.toString.call(func))
              }

              if (hook === 'onSend' || hook === 'preSerialization' || hook === 'onError' || hook === 'preParsing') {
                if (func.constructor.name === 'AsyncFunction' && func.length === 4) {
                  throw new FST_ERR_HOOK_INVALID_ASYNC_HANDLER()
                }
              } else if (hook === 'onRequestAbort') {
                if (func.constructor.name === 'AsyncFunction' && func.length !== 1) {
                  throw new FST_ERR_HOOK_INVALID_ASYNC_HANDLER()
                }
              } else {
                if (func.constructor.name === 'AsyncFunction' && func.length === 3) {
                  throw new FST_ERR_HOOK_INVALID_ASYNC_HANDLER()
                }
              }
            }
          } else if (opts[hook] !== undefined && typeof opts[hook] !== 'function') {
            throw new FST_ERR_HOOK_INVALID_HANDLER(hook, Object.prototype.toString.call(opts[hook]))
          }
        }
      }

      const constraints = opts.constraints || {}
      const config = {
        ...opts.config,
        url,
        method: opts.method
      }

      const context = new Context({
        schema: opts.schema,
        handler: opts.handler.bind(this),
        config,
        errorHandler: opts.errorHandler,
        childLoggerFactory: opts.childLoggerFactory,
        bodyLimit: opts.bodyLimit,
        logLevel: opts.logLevel,
        logSerializers: opts.logSerializers,
        attachValidation: opts.attachValidation,
        schemaErrorFormatter: opts.schemaErrorFormatter,
        replySerializer: this[kReplySerializerDefault],
        validatorCompiler: opts.validatorCompiler,
        serializerCompiler: opts.serializerCompiler,
        exposeHeadRoute: shouldExposeHead,
        prefixTrailingSlash: (opts.prefixTrailingSlash || 'both'),
        server: this,
        isFastify
      })

      const headHandler = router.findRoute('HEAD', opts.url, constraints)
      const hasHEADHandler = headHandler !== null

      try {
        router.on(opts.method, opts.url, { constraints }, routeHandler, context)
      } catch (error: any) {
        // any route insertion error created by fastify can be safely ignore
        // because it only duplicate route for head
        if (!context[kRouteByFastify]) {
          const isDuplicatedRoute = error.message.includes(`Method '${opts.method}' already declared for route`)
          if (isDuplicatedRoute) {
            throw new FST_ERR_DUPLICATED_ROUTE(opts.method, opts.url)
          }

          throw error
        }
      }

      this.after((notHandledErr: any, done: any) => {
        // Send context async
        context.errorHandler = opts.errorHandler ? buildErrorHandler(this[kErrorHandler], opts.errorHandler) : this[kErrorHandler]
        context._parserOptions.limit = opts.bodyLimit || null
        context.logLevel = opts.logLevel
        context.logSerializers = opts.logSerializers
        context.attachValidation = opts.attachValidation
        context[kReplySerializerDefault] = this[kReplySerializerDefault]
        context.schemaErrorFormatter = opts.schemaErrorFormatter || this[kSchemaErrorFormatter] || context.schemaErrorFormatter

        // Run hooks and more
        avvio.once('preReady', () => {
          for (const hook of lifecycleHooks) {
            const toSet = this[kHooks][hook]
              .concat(opts[hook] || [])
              .map((h: any) => h.bind(this))
            context[hook] = toSet.length ? toSet : null
          }

          // Optimization: avoid encapsulation if no decoration has been done.
          while (!context.Request[kHasBeenDecorated] && context.Request.parent) {
            context.Request = context.Request.parent
          }
          while (!context.Reply[kHasBeenDecorated] && context.Reply.parent) {
            context.Reply = context.Reply.parent
          }

          // Must store the 404 Context in 'preReady' because it is only guaranteed to
          // be available after all of the plugins and routes have been loaded.
          fourOhFour.setContext(this, context)

          if (opts.schema) {
            context.schema = normalizeSchema(context.schema, this.initialConfig)

            const schemaController = this[kSchemaController]
            if (!opts.validatorCompiler && (opts.schema.body || opts.schema.headers || opts.schema.querystring || opts.schema.params)) {
              schemaController.setupValidator(this[kOptions])
            }
            try {
              const isCustom = typeof opts?.validatorCompiler === 'function' || schemaController.isCustomValidatorCompiler
              compileSchemasForValidation(context, opts.validatorCompiler || schemaController.validatorCompiler, isCustom)
            } catch (error: any) {
              throw new FST_ERR_SCH_VALIDATION_BUILD(opts.method, url, error.message)
            }

            if (opts.schema.response && !opts.serializerCompiler) {
              schemaController.setupSerializer(this[kOptions])
            }
            try {
              compileSchemasForSerialization(context, opts.serializerCompiler || schemaController.serializerCompiler)
            } catch (error: any) {
              throw new FST_ERR_SCH_SERIALIZATION_BUILD(opts.method, url, error.message)
            }
          }
        })

        done(notHandledErr)
      })

      // register head route in sync
      // we must place it after the `this.after`

      if (shouldExposeHead && isGetRoute && !isHeadRoute && !hasHEADHandler) {
        const onSendHandlers = parseHeadOnSendHandlers(headOpts.onSend)
        prepareRoute.call(this, { method: 'HEAD', url: path, options: { ...headOpts, onSend: onSendHandlers }, isFastify: true })
      }
    }
  }

  // HTTP request entry point, the routing has already been executed
  function routeHandler (req: FY.Incoming, res: FY.Outgoing, params: unknown, context: FY.Context, query: unknown) {
    const id = getGenReqId(context.server, req)

    const loggerOpts: { level: string, serializers?: any } = {
      level: context.logLevel
    }

    if (context.logSerializers) {
      loggerOpts.serializers = context.logSerializers
    }
    const childLogger = createChildLogger(context, logger, req, id, loggerOpts)
    childLogger[kDisableRequestLogging] = disableRequestLogging

    if (closing === true) {
      /* istanbul ignore next mac, windows */
      if (req.httpVersionMajor !== 2) {
        res.setHeader('Connection', 'close')
      }

      // TODO remove return503OnClosing after Node v18 goes EOL
      /* istanbul ignore else */
      if (return503OnClosing) {
        // On Node v19 we cannot test this behavior as it won't be necessary
        // anymore. It will close all the idle connections before they reach this
        // stage.
        const headers = {
          'Content-Type': 'application/json',
          'Content-Length': '80'
        }
        res.writeHead(503, headers)
        res.end('{"error":"Service Unavailable","message":"Service Unavailable","statusCode":503}')
        childLogger.info({ res: { statusCode: 503 } }, 'request aborted - refusing to accept new requests as server is closing')
        return
      }
    }

    // When server.forceCloseConnections is true, we will collect any requests
    // that have indicated they want persistence so that they can be reaped
    // on server close. Otherwise, the container is a noop container.
    const connHeader = String.prototype.toLowerCase.call(req.headers.connection || '')
    if (connHeader === 'keep-alive') {
      if (keepAliveConnections.has(req.socket) === false) {
        keepAliveConnections.add(req.socket)
        req.socket.on('close', removeTrackedSocket.bind({ keepAliveConnections, socket: req.socket }))
      }
    }

    // we revert the changes in defaultRoute
    if ((req.headers as any)[kRequestAcceptVersion] !== undefined) {
      req.headers['accept-version'] = (req.headers as any)[kRequestAcceptVersion]
      ;(req.headers as any)[kRequestAcceptVersion] = undefined
    }

    const request = new context.Request(id, params, req, query, childLogger, context)
    const reply = new context.Reply(res, request, childLogger)
    if (disableRequestLogging === false) {
      childLogger.info({ req: request }, 'incoming request')
    }

    if (hasLogger === true || context.onResponse !== null) {
      setupResponseListeners(reply)
    }

    if (context.onRequest !== null) {
      onRequestHookRunner(
        context.onRequest,
        request,
        reply,
        runPreParsing
      )
    } else {
      runPreParsing(null, request, reply)
    }

    if (context.onRequestAbort !== null) {
      req.on('close', () => {
        /* istanbul ignore else */
        if (req.aborted) {
          onRequestAbortHookRunner(
            context.onRequestAbort,
            request,
            handleOnRequestAbortHooksErrors.bind(null, reply)
          )
        }
      })
    }

    if (context.onTimeout !== null) {
      if (!(request.raw.socket as any)._meta) {
        request.raw.socket.on('timeout', handleTimeout)
      }
      (request.raw.socket as any)._meta = { context, request, reply }
    }
  }
}

function handleOnRequestAbortHooksErrors (reply: FY.Reply, err: any) {
  if (err) {
    reply.log.error({ err }, 'onRequestAborted hook failed')
  }
}

function handleTimeout (this: any) {
  const { context, request, reply } = this._meta
  onTimeoutHookRunner(
    context.onTimeout,
    request,
    reply,
    noop
  )
}

function normalizeAndValidateMethod (this: any, method: any) {
  if (typeof method !== 'string') {
    throw new FST_ERR_ROUTE_METHOD_INVALID()
  }
  method = method.toUpperCase()
  if (!this[kSupportedHTTPMethods].bodyless.has(method) &&
    !this[kSupportedHTTPMethods].bodywith.has(method)) {
    throw new FST_ERR_ROUTE_METHOD_NOT_SUPPORTED(method)
  }

  return method
}

function validateSchemaBodyOption (this: any, method: any, path: any, schema: any) {
  if (this[kSupportedHTTPMethods].bodyless.has(method) && schema?.body) {
    throw new FST_ERR_ROUTE_BODY_VALIDATION_SCHEMA_NOT_SUPPORTED(method, path)
  }
}

function validateBodyLimitOption (bodyLimit: any) {
  if (bodyLimit === undefined) return
  if (!Number.isInteger(bodyLimit) || bodyLimit <= 0) {
    throw new FST_ERR_ROUTE_BODY_LIMIT_OPTION_NOT_INT(bodyLimit)
  }
}

function runPreParsing (this: any, err: any, request: FY.Request, reply: FY.Reply) {
  if (reply.sent === true) return
  if (err != null) {
    reply[kReplyIsError] = true
    reply.send(err)
    return
  }

  request[kRequestPayloadStream] = request.raw

  if (request[kRouteContext].preParsing !== null) {
    preParsingHookRunner(request[kRouteContext].preParsing, request, reply, handleRequest.bind(request.server))
  } else {
    handleRequest.call(request.server, null, request, reply)
  }
}

/**
 * Used within the route handler as a `net.Socket.close` event handler.
 * The purpose is to remove a socket from the tracked sockets collection when
 * the socket has naturally timed out.
 */
function removeTrackedSocket (this: any) {
  this.keepAliveConnections.delete(this.socket)
}

function noop () { }

module.exports = { buildRouting, validateBodyLimitOption }

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
