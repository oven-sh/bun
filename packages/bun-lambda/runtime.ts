import type { Server, ServerWebSocket } from "bun";
import { AwsClient } from "aws4fetch";

type Lambda = {
  fetch: (request: Request, server: Server) => Promise<Response | undefined>;
  error?: (error: unknown) => Promise<Response>;
  websocket?: {
    open?: (ws: ServerWebSocket) => Promise<void>;
    message?: (ws: ServerWebSocket, message: string) => Promise<void>;
    close?: (ws: ServerWebSocket, code: number, reason: string) => Promise<void>;
  };
};

let requestId: string | undefined;
let traceId: string | undefined;
let functionArn: string | undefined;
let aws: AwsClient | undefined;

let logger = console.log;

function log(level: string, ...args: any[]): void {
  if (!args.length) {
    return;
  }
  const messages = args.map(arg => Bun.inspect(arg).replace(/\n/g, "\r"));
  if (requestId === undefined) {
    logger(level, ...messages);
  } else {
    logger(level, `RequestId: ${requestId}`, ...messages);
  }
}

console.log = (...args: any[]) => log("INFO", ...args);
console.info = (...args: any[]) => log("INFO", ...args);
console.warn = (...args: any[]) => log("WARN", ...args);
console.error = (...args: any[]) => log("ERROR", ...args);
console.debug = (...args: any[]) => log("DEBUG", ...args);
console.trace = (...args: any[]) => log("TRACE", ...args);

let warnings: Set<string> | undefined;

function warnOnce(message: string, ...args: any[]): void {
  if (warnings === undefined) {
    warnings = new Set();
  }
  if (warnings.has(message)) {
    return;
  }
  warnings.add(message);
  console.warn(message, ...args);
}

function reset(): void {
  requestId = undefined;
  traceId = undefined;
  warnings = undefined;
}

function exit(...cause: any[]): never {
  console.error(...cause);
  process.exit(1);
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback ?? null;
  if (value === null) {
    exit(`Runtime failed to find the '${name}' environment variable`);
  }
  return value;
}

const runtimeUrl = new URL(`http://${env("AWS_LAMBDA_RUNTIME_API")}/2018-06-01/`);

async function fetch(url: string, options?: RequestInit): Promise<Response> {
  const { href } = new URL(url, runtimeUrl);
  const response = await globalThis.fetch(href, {
    ...options,
    timeout: false,
  });
  if (!response.ok) {
    exit(`Runtime failed to send request to Lambda [status: ${response.status}]`);
  }
  return response;
}

async function fetchAws(url: string, options?: RequestInit): Promise<Response> {
  if (aws === undefined) {
    aws = new AwsClient({
      accessKeyId: env("AWS_ACCESS_KEY_ID"),
      secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
      sessionToken: env("AWS_SESSION_TOKEN"),
      region: env("AWS_REGION"),
    });
  }
  return aws.fetch(url, options);
}

type LambdaError = {
  readonly errorType: string;
  readonly errorMessage: string;
  readonly stackTrace?: string[];
};

function formatError(error: unknown): LambdaError {
  if (error instanceof Error) {
    return {
      errorType: error.name,
      errorMessage: error.message,
      stackTrace: error.stack?.split("\n").filter(line => !line.includes(" /opt/runtime.ts")),
    };
  }
  return {
    errorType: "Error",
    errorMessage: Bun.inspect(error),
  };
}

async function sendError(type: string, cause: unknown): Promise<void> {
  console.error(cause);
  await fetch(requestId === undefined ? "runtime/init/error" : `runtime/invocation/${requestId}/error`, {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.aws.lambda.error+json",
      "Lambda-Runtime-Function-Error-Type": `Bun.${type}`,
    },
    body: JSON.stringify(formatError(cause)),
  });
}

async function throwError(type: string, cause: unknown): Promise<never> {
  await sendError(type, cause);
  exit();
}

async function init(): Promise<Lambda> {
  const handlerName = env("_HANDLER");
  const index = handlerName.lastIndexOf(".");
  const fileName = handlerName.substring(0, index);
  const filePath = `${env("LAMBDA_TASK_ROOT")}/${fileName}`;
  let file;
  try {
    file = await import(filePath);
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("Cannot find module")) {
      return throwError("FileDoesNotExist", `Did not find a file named '${fileName}'`);
    }
    return throwError("InitError", cause);
  }
  const moduleName = handlerName.substring(index + 1) || "fetch";
  let module = file["default"] ?? file[moduleName] ?? {};
  if (typeof module === "function") {
    module = {
      fetch: module,
    };
  } else if (typeof module === "object" && moduleName !== "fetch") {
    module = {
      ...module,
      fetch: module[moduleName],
    };
  }
  const { fetch, websocket } = module;
  if (typeof fetch !== "function") {
    return throwError(
      fetch === undefined ? "MethodDoesNotExist" : "MethodIsNotAFunction",
      `${fileName} does not have a default export with a function named '${moduleName}'`,
    );
  }
  if (websocket === undefined) {
    return module;
  }
  for (const name of ["open", "message", "close"]) {
    const method = websocket[name];
    if (method === undefined) {
      continue;
    }
    if (typeof method !== "function") {
      return throwError(
        "MethodIsNotAFunction",
        `${fileName} does not have a function named '${name}' on the default 'websocket' property`,
      );
    }
  }
  return module;
}

type LambdaRequest<E = any> = {
  readonly requestId: string;
  readonly traceId: string;
  readonly functionArn: string;
  readonly deadlineMs: number | null;
  readonly event: E;
};

async function receiveRequest(): Promise<LambdaRequest> {
  const response = await fetch("runtime/invocation/next");
  requestId = response.headers.get("Lambda-Runtime-Aws-Request-Id") ?? undefined;
  if (requestId === undefined) {
    exit("Runtime received a request without a request ID");
  }
  traceId = response.headers.get("Lambda-Runtime-Trace-Id") ?? undefined;
  if (traceId === undefined) {
    exit("Runtime received a request without a trace ID");
  }
  process.env["_X_AMZN_TRACE_ID"] = traceId;
  functionArn = response.headers.get("Lambda-Runtime-Invoked-Function-Arn") ?? undefined;
  if (functionArn === undefined) {
    exit("Runtime received a request without a function ARN");
  }
  const deadlineMs = parseInt(response.headers.get("Lambda-Runtime-Deadline-Ms") ?? "0") || null;
  let event;
  try {
    event = await response.json();
  } catch (cause) {
    exit("Runtime received a request with invalid JSON", cause);
  }
  return {
    requestId,
    traceId,
    functionArn,
    deadlineMs,
    event,
  };
}

type LambdaResponse = {
  readonly statusCode: number;
  readonly headers?: Record<string, string>;
  readonly isBase64Encoded?: boolean;
  readonly body?: string;
  readonly multiValueHeaders?: Record<string, string[]>;
  readonly cookies?: string[];
};

async function formatResponse(response: Response): Promise<LambdaResponse> {
  const statusCode = response.status;
  const headers = response.headers.toJSON();
  if (statusCode === 101) {
    const protocol = headers["sec-websocket-protocol"];
    if (protocol === undefined) {
      return {
        statusCode: 200,
      };
    }
    return {
      statusCode: 200,
      headers: {
        "Sec-WebSocket-Protocol": protocol,
      },
    };
  }
  const mime = headers["content-type"];
  const isBase64Encoded = !mime || (!mime.startsWith("text/") && !mime.startsWith("application/json"));
  const body = isBase64Encoded ? Buffer.from(await response.arrayBuffer()).toString("base64") : await response.text();
  delete headers["set-cookie"];
  const cookies = response.headers.getAll("Set-Cookie");
  if (cookies.length === 0) {
    return {
      statusCode,
      headers,
      isBase64Encoded,
      body,
    };
  }
  return {
    statusCode,
    headers,
    cookies,
    multiValueHeaders: {
      "Set-Cookie": cookies,
    },
    isBase64Encoded,
    body,
  };
}

async function sendResponse(response: unknown): Promise<void> {
  if (requestId === undefined) {
    exit("Runtime attempted to send a response without a request ID");
  }
  await fetch(`runtime/invocation/${requestId}/response`, {
    method: "POST",
    body: response === null ? null : typeof response === "string" ? response : JSON.stringify(response),
  });
}

function formatBody(body?: string, isBase64Encoded?: boolean): string | null {
  if (body === undefined) {
    return null;
  }
  if (!isBase64Encoded) {
    return body;
  }
  return Buffer.from(body).toString("base64");
}

type HttpEventV1 = {
  readonly requestContext: {
    readonly requestId: string;
    readonly domainName: string;
    readonly httpMethod: string;
    readonly path: string;
  };
  readonly headers: Record<string, string>;
  readonly multiValueHeaders?: Record<string, string[]>;
  readonly queryStringParameters?: Record<string, string>;
  readonly multiValueQueryStringParameters?: Record<string, string[]>;
  readonly isBase64Encoded: boolean;
  readonly body?: string;
};

function isHttpEventV1(event: any): event is HttpEventV1 {
  return !event.Records && event.version !== "2.0" && event.version !== "0" && typeof event.requestContext === "object";
}

function formatHttpEventV1(event: HttpEventV1): Request {
  const request = event.requestContext;
  const headers = new Headers();
  for (const [name, values] of Object.entries(event.multiValueHeaders ?? {})) {
    for (const value of values) {
      headers.append(name, value);
    }
  }
  const hostname = headers.get("Host") ?? request.domainName;
  const proto = headers.get("X-Forwarded-Proto") ?? "http";
  const url = new URL(request.path, `${proto}://${hostname}/`);
  for (const [name, values] of Object.entries(event.multiValueQueryStringParameters ?? {})) {
    for (const value of values ?? []) {
      url.searchParams.append(name, value);
    }
  }
  return new Request(url.toString(), {
    method: request.httpMethod,
    headers,
    body: formatBody(event.body, event.isBase64Encoded),
  });
}

type HttpEventV2 = {
  readonly version: "2.0";
  readonly requestContext: {
    readonly requestId: string;
    readonly domainName: string;
    readonly http: {
      readonly method: string;
      readonly path: string;
    };
  };
  readonly headers: Record<string, string>;
  readonly queryStringParameters?: Record<string, string>;
  readonly cookies?: string[];
  readonly isBase64Encoded: boolean;
  readonly body?: string;
};

function isHttpEventV2(event: any): event is HttpEventV2 {
  return !event.Records && event.version === "2.0" && typeof event.requestContext === "object";
}

function formatHttpEventV2(event: HttpEventV2): Request {
  const request = event.requestContext;
  const headers = new Headers();
  for (const [name, values] of Object.entries(event.headers)) {
    for (const value of values.split(",")) {
      headers.append(name, value);
    }
  }
  for (const [name, values] of Object.entries(event.queryStringParameters ?? {})) {
    for (const value of values.split(",")) {
      headers.append(name, value);
    }
  }
  for (const cookie of event.cookies ?? []) {
    headers.append("Set-Cookie", cookie);
  }
  const hostname = headers.get("Host") ?? request.domainName;
  const proto = headers.get("X-Forwarded-Proto") ?? "http";
  const url = new URL(request.http.path, `${proto}://${hostname}/`);
  return new Request(url.toString(), {
    method: request.http.method,
    headers,
    body: formatBody(event.body, event.isBase64Encoded),
  });
}

function isHttpEvent(event: any): boolean {
  return isHttpEventV1(event) || isHttpEventV2(event);
}

type WebSocketEvent = {
  readonly headers: Record<string, string>;
  readonly multiValueHeaders: Record<string, string[]>;
  readonly isBase64Encoded: boolean;
  readonly body?: string;
  readonly requestContext: {
    readonly apiId: string;
    readonly requestId: string;
    readonly connectionId: string;
    readonly domainName: string;
    readonly stage: string;
    readonly identity: {
      readonly sourceIp: string;
    };
  } & (
    | {
        readonly eventType: "CONNECT";
      }
    | {
        readonly eventType: "MESSAGE";
      }
    | {
        readonly eventType: "DISCONNECT";
        readonly disconnectStatusCode: number;
        readonly disconnectReason: string;
      }
  );
};

function isWebSocketEvent(event: any): event is WebSocketEvent {
  return typeof event.requestContext === "object" && typeof event.requestContext.connectionId === "string";
}

function isWebSocketUpgrade(event: any): event is WebSocketEvent {
  return isWebSocketEvent(event) && event.requestContext.eventType === "CONNECT";
}

function formatWebSocketUpgrade(event: WebSocketEvent): Request {
  const request = event.requestContext;
  const headers = new Headers();
  headers.set("Upgrade", "websocket");
  headers.set("x-amzn-connection-id", request.connectionId);
  for (const [name, values] of Object.entries(event.multiValueHeaders as any)) {
    for (const value of (values as any) ?? []) {
      headers.append(name, value);
    }
  }
  const hostname = headers.get("Host") ?? request.domainName;
  const proto = headers.get("X-Forwarded-Proto") ?? "http";
  const url = new URL(`${proto}://${hostname}/${request.stage}`);
  return new Request(url.toString(), {
    headers,
    body: formatBody(event.body, event.isBase64Encoded),
  });
}

function formatUnknownEvent(event: unknown): Request {
  return new Request("https://lambda/", {
    method: "POST",
    body: JSON.stringify(event),
    headers: {
      "Content-Type": "application/json;charset=utf-8",
    },
  });
}

function formatRequest(input: LambdaRequest): Request | undefined {
  const { event, requestId, traceId, functionArn, deadlineMs } = input;
  let request: Request;
  if (isHttpEventV2(event)) {
    request = formatHttpEventV2(event);
  } else if (isHttpEventV1(event)) {
    request = formatHttpEventV1(event);
  } else if (isWebSocketEvent(event)) {
    if (!isWebSocketUpgrade(event)) {
      return undefined;
    }
    request = formatWebSocketUpgrade(event);
  } else {
    request = formatUnknownEvent(input);
  }
  request.headers.set("x-amzn-requestid", requestId);
  request.headers.set("x-amzn-trace-id", traceId);
  request.headers.set("x-amzn-function-arn", functionArn);
  if (deadlineMs !== null) {
    request.headers.set("x-amzn-deadline-ms", `${deadlineMs}`);
  }
  // @ts-ignore: Attach the original event to the Request
  request.aws = event;
  return request;
}

class LambdaServer implements Server {
  #lambda: Lambda;
  #webSockets: Map<string, LambdaWebSocket>;
  #upgrade: Response | null;
  pendingRequests: number;
  pendingWebSockets: number;
  port: number;
  hostname: string;
  development: boolean;

  constructor(lambda: Lambda) {
    this.#lambda = lambda;
    this.#webSockets = new Map();
    this.#upgrade = null;
    this.pendingRequests = 0;
    this.pendingWebSockets = 0;
    this.port = 80;
    this.hostname = "lambda";
    this.development = false;
  }

  async accept(request: LambdaRequest): Promise<unknown> {
    const deadlineMs = request.deadlineMs === null ? Date.now() + 60_000 : request.deadlineMs;
    const durationMs = Math.max(1, deadlineMs - Date.now());
    let response: unknown;
    try {
      response = await Promise.race([
        new Promise<undefined>(resolve => setTimeout(resolve, durationMs)),
        this.#acceptRequest(request),
      ]);
    } catch (cause) {
      await sendError("RequestError", cause);
      return;
    }
    if (response === undefined) {
      await sendError("TimeoutError", "Function timed out");
      return;
    }
    return response;
  }

  async #acceptRequest(event: LambdaRequest): Promise<unknown> {
    const request = formatRequest(event);
    let response: Response | undefined;
    if (request === undefined) {
      await this.#acceptWebSocket(event.event);
    } else {
      response = await this.fetch(request);
      if (response.status === 101) {
        await this.#acceptWebSocket(event.event);
      }
    }
    if (response === undefined) {
      return {
        statusCode: 200,
      };
    }
    if (!isHttpEvent(event.event)) {
      return response.text();
    }
    return formatResponse(response);
  }

  async #acceptWebSocket(event: WebSocketEvent): Promise<void> {
    const request = event.requestContext;
    const { connectionId, eventType } = request;
    const webSocket = this.#webSockets.get(connectionId);
    if (webSocket === undefined || this.#lambda.websocket === undefined) {
      return;
    }
    const { open, message, close } = this.#lambda.websocket;
    switch (eventType) {
      case "CONNECT": {
        if (open) {
          await open(webSocket);
        }
        break;
      }
      case "MESSAGE": {
        if (message) {
          const body = formatBody(event.body, event.isBase64Encoded);
          if (body !== null) {
            await message(webSocket, body);
          }
        }
        break;
      }
      case "DISCONNECT": {
        try {
          if (close) {
            const { disconnectStatusCode: code, disconnectReason: reason } = request;
            await close(webSocket, code, reason);
          }
        } finally {
          this.#webSockets.delete(connectionId);
          this.pendingWebSockets--;
        }
        break;
      }
    }
  }

  stop(): void {
    exit("Runtime exited because Server.stop() was called");
  }

  reload(options: any): void {
    this.#lambda = {
      fetch: options.fetch ?? this.#lambda.fetch,
      error: options.error ?? this.#lambda.error,
      websocket: options.websocket ?? this.#lambda.websocket,
    };
    this.port =
      typeof options.port === "number"
        ? options.port
        : typeof options.port === "string"
          ? parseInt(options.port)
          : this.port;
    this.hostname = options.hostname ?? this.hostname;
    this.development = options.development ?? this.development;
  }

  async fetch(request: Request): Promise<Response> {
    this.pendingRequests++;
    try {
      let response = await this.#lambda.fetch(request, this);
      if (response instanceof Response) {
        return response;
      }
      if (response === undefined && this.#upgrade !== null) {
        return this.#upgrade;
      }
      throw new Error("fetch() did not return a Response");
    } catch (cause) {
      console.error(cause);
      if (this.#lambda.error !== undefined) {
        try {
          return await this.#lambda.error(cause);
        } catch (cause) {
          console.error(cause);
        }
      }
      return new Response(null, { status: 500 });
    } finally {
      this.pendingRequests--;
      this.#upgrade = null;
    }
  }

  upgrade<T = undefined>(
    request: Request,
    options?: {
      headers?: HeadersInit;
      data?: T;
    },
  ): boolean {
    if (request.method === "GET" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      this.#upgrade = new Response(null, {
        status: 101,
        headers: options?.headers,
      });
      if ("aws" in request && isWebSocketUpgrade(request.aws)) {
        const { connectionId } = request.aws.requestContext;
        this.#webSockets.set(connectionId, new LambdaWebSocket(request.aws, options?.data));
        this.pendingWebSockets++;
      }
      return true;
    }
    return false;
  }

  publish(topic: string, data: string | ArrayBuffer | ArrayBufferView, compress?: boolean): number {
    let count = 0;
    for (const webSocket of this.#webSockets.values()) {
      count += webSocket.publish(topic, data, compress) ? 1 : 0;
    }
    return count;
  }
}

class LambdaWebSocket implements ServerWebSocket {
  #connectionId: string;
  #url: string;
  #invokeArn: string;
  #topics: Set<string> | null;
  remoteAddress: string;
  readyState: 0 | 2 | 1 | -1 | 3;
  binaryType?: "arraybuffer" | "uint8array";
  data: any;

  constructor(event: WebSocketEvent, data?: any) {
    const request = event.requestContext;
    this.#connectionId = `${request.connectionId}`;
    this.#url = `https://${request.domainName}/${request.stage}/@connections/${this.#connectionId}`;
    const [region, accountId] = (functionArn ?? "").split(":").slice(3, 5);
    this.#invokeArn = `arn:aws:execute-api:${region}:${accountId}:${request.apiId}/${request.stage}/*`;
    this.#topics = null;
    this.remoteAddress = request.identity.sourceIp;
    this.readyState = 1; // WebSocket.OPEN
    this.data = data;
  }

  send(data: string | ArrayBuffer | ArrayBufferView, compress?: boolean): number {
    if (typeof data === "string") {
      return this.sendText(data, compress);
    }
    if (data instanceof ArrayBuffer) {
      return this.sendBinary(new Uint8Array(data), compress);
    }
    const buffer = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return this.sendBinary(buffer, compress);
  }

  sendText(data: string, compress?: boolean): number {
    fetchAws(this.#url, {
      method: "POST",
      body: data,
    })
      .then(({ status }) => {
        if (status === 403) {
          warnOnce(
            "Failed to send WebSocket message due to insufficient IAM permissions",
            `Assign the following IAM policy to ${functionArn} to fix this issue:`,
            {
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Action: ["execute-api:Invoke"],
                  Resource: [this.#invokeArn],
                },
              ],
            },
          );
        } else {
          warnOnce(`Failed to send WebSocket message due to a ${status} error`);
        }
      })
      .catch(error => {
        warnOnce("Failed to send WebSocket message", error);
      });
    return data.length;
  }

  sendBinary(data: Uint8Array, compress?: boolean): number {
    warnOnce(
      "Lambda does not support binary WebSocket messages",
      "https://docs.aws.amazon.com/apigateway/latest/developerguide/websocket-api-develop-binary-media-types.html",
    );
    const base64 = Buffer.from(data).toString("base64");
    return this.sendText(base64, compress);
  }

  publish(topic: string, data: string | ArrayBuffer | ArrayBufferView, compress?: boolean): number {
    if (this.isSubscribed(topic)) {
      return this.send(data, compress);
    }
    return -1;
  }

  publishText(topic: string, data: string, compress?: boolean): number {
    if (this.isSubscribed(topic)) {
      return this.sendText(data, compress);
    }
    return -1;
  }

  publishBinary(topic: string, data: Uint8Array, compress?: boolean): number {
    if (this.isSubscribed(topic)) {
      return this.sendBinary(data, compress);
    }
    return -1;
  }

  close(code?: number, reason?: string): void {
    // TODO: code? reason?
    fetchAws(this.#url, {
      method: "DELETE",
    })
      .then(({ status }) => {
        if (status === 403) {
          warnOnce(
            "Failed to close WebSocket due to insufficient IAM permissions",
            `Assign the following IAM policy to ${functionArn} to fix this issue:`,
            {
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Action: ["execute-api:Invoke"],
                  Resource: [this.#invokeArn],
                },
              ],
            },
          );
        } else {
          warnOnce(`Failed to close WebSocket due to a ${status} error`);
        }
      })
      .catch(error => {
        warnOnce("Failed to close WebSocket", error);
      });
    this.readyState = 3; // WebSocket.CLOSED;
  }

  subscribe(topic: string): void {
    if (this.#topics === null) {
      this.#topics = new Set();
    }
    this.#topics.add(topic);
  }

  unsubscribe(topic: string): void {
    if (this.#topics !== null) {
      this.#topics.delete(topic);
    }
  }

  isSubscribed(topic: string): boolean {
    return this.#topics !== null && this.#topics.has(topic);
  }

  cork(callback: (ws: ServerWebSocket<undefined>) => any): void | Promise<void> {
    // Lambda does not support sending multiple messages at a time.
    return callback(this);
  }
}

const lambda = await init();
const server = new LambdaServer(lambda);
while (true) {
  try {
    const request = await receiveRequest();
    const response = await server.accept(request);
    if (response !== undefined) {
      await sendResponse(response);
    }
  } finally {
    reset();
  }
}
