/**
 * Native Express.js shim for Bun.serve
 *
 * This provides a native Express.js implementation that works directly
 * with Bun.serve, avoiding the Node.js compatibility layer for better performance.
 *
 * Usage:
 * ```ts
 * import express from "express";
 * const app = express();
 *
 * app.get("/", (req, res) => {
 *   res.send("Hello World");
 * });
 *
 * // Works with bun.serve directly
 * Bun.serve({
 *   fetch: app.fetch.bind(app),
 *   port: 3000,
 * });
 * ```
 */

import type { Server } from "bun";

// Express Request object that wraps Bun's Request
class ExpressRequest {
  private _bunRequest: Request;
  private _url: URL;
  private _params: Record<string, string> = {};
  private _query: Record<string, string> = {};
  private _body: any = null;
  private _cookies: Record<string, string> = {};

  constructor(bunRequest: Request) {
    this._bunRequest = bunRequest;
    this._url = new URL(bunRequest.url);
    this._parseQuery();
    this._parseCookies();
  }

  private _parseQuery() {
    for (const [key, value] of this._url.searchParams.entries()) {
      this._query[key] = value;
    }
  }

  private _parseCookies() {
    const cookieHeader = this._bunRequest.headers.get("cookie");
    if (cookieHeader) {
      for (const cookie of cookieHeader.split(";")) {
        const trimmed = cookie.trim();
        const equalIndex = trimmed.indexOf("=");
        if (equalIndex > 0) {
          const key = trimmed.slice(0, equalIndex);
          const value = trimmed.slice(equalIndex + 1);
          if (key && value) {
            this._cookies[key] = decodeURIComponent(value);
          }
        }
      }
    }
  }

  // Express Request API
  get method(): string {
    return this._bunRequest.method;
  }

  get url(): string {
    return this._url.pathname + this._url.search;
  }

  get originalUrl(): string {
    return this._url.pathname + this._url.search;
  }

  get path(): string {
    return this._url.pathname;
  }

  get query(): Record<string, string> {
    return this._query;
  }

  get params(): Record<string, string> {
    return this._params;
  }

  set params(value: Record<string, string>) {
    this._params = value;
  }

  get headers(): Headers {
    return this._bunRequest.headers;
  }

  get body(): any {
    return this._body;
  }

  set body(value: any) {
    this._body = value;
  }

  get cookies(): Record<string, string> {
    return this._cookies;
  }

  get ip(): string {
    // This would need to be passed from the server
    return "127.0.0.1";
  }

  get protocol(): string {
    return this._url.protocol.slice(0, -1);
  }

  get secure(): boolean {
    return this.protocol === "https";
  }

  get hostname(): string {
    return this._url.hostname;
  }

  get host(): string {
    return this._url.host;
  }

  get fresh(): boolean {
    // TODO: implement freshness check
    return false;
  }

  get stale(): boolean {
    return !this.fresh;
  }

  get xhr(): boolean {
    return this._bunRequest.headers.get("x-requested-with") === "XMLHttpRequest";
  }

  get(field: string): string | undefined {
    if (typeof this._bunRequest.headers.get === "function") {
      return this._bunRequest.headers.get(field) ?? undefined;
    }
    // Fallback: lowercased key lookup on headers object
    const lowerField = field.toLowerCase();
    for (const [key, value] of this._bunRequest.headers.entries()) {
      if (key.toLowerCase() === lowerField) {
        return value;
      }
    }
    return undefined;
  }

  header(field: string): string | undefined {
    return this.get(field);
  }

  is(type: string): string | false {
    const contentType = this._bunRequest.headers.get("content-type") || "";
    if (!type) return contentType;
    return contentType.includes(type) ? type : false;
  }

  get range() {
    // TODO: implement range parsing
    return undefined;
  }

  accepts(): string[] {
    // TODO: implement accept header parsing
    return [];
  }

  acceptsEncodings(): string[] {
    // TODO: implement encoding negotiation
    return [];
  }

  acceptsCharsets(): string[] {
    // TODO: implement charset negotiation
    return [];
  }

  acceptsLanguages(): string[] {
    // TODO: implement language negotiation
    return [];
  }

  // Internal: get the underlying Bun Request
  get _bun(): Request {
    return this._bunRequest;
  }
}

// Express Response object that wraps Bun's Response
class ExpressResponse {
  private _statusCode: number = 200;
  private _headers: Headers = new Headers();
  private _body: any = null;
  private _locals: Record<string, any> = {};
  private _sent: boolean = false;

  constructor() {}

  // Express Response API
  get statusCode(): number {
    return this._statusCode;
  }

  set statusCode(value: number) {
    this._statusCode = value;
  }

  get headersSent(): boolean {
    return this._sent;
  }

  get locals(): Record<string, any> {
    return this._locals;
  }

  status(code: number): this {
    this._statusCode = code;
    return this;
  }

  set(field: string, value?: string): this {
    if (value === undefined) {
      // Handle object case
      if (typeof field === "object") {
        for (const [key, val] of Object.entries(field)) {
          this._headers.set(key, String(val));
        }
      }
    } else {
      this._headers.set(field, value);
    }
    return this;
  }

  get(field: string): string | null {
    return this._headers.get(field);
  }

  header(field: string, value?: string): this {
    return this.set(field, value);
  }

  cookie(name: string, value: string, options?: any): this {
    // Encode both name and value
    const encodedName = encodeURIComponent(name);
    const encodedValue = encodeURIComponent(value);

    // Build cookie string starting with name=value
    const parts: string[] = [`${encodedName}=${encodedValue}`];

    // Serialize options
    if (options) {
      // Expires: Date -> toUTCString()
      if (options.expires) {
        if (options.expires instanceof Date) {
          parts.push(`Expires=${options.expires.toUTCString()}`);
        }
      }

      // Max-Age: number -> Max-Age=<number>
      if (options.maxAge !== undefined && options.maxAge !== null) {
        parts.push(`Max-Age=${options.maxAge}`);
      }

      // Path
      if (options.path) {
        parts.push(`Path=${options.path}`);
      }

      // Domain
      if (options.domain) {
        parts.push(`Domain=${options.domain}`);
      }

      // Secure flag (boolean)
      if (options.secure === true) {
        parts.push("Secure");
      }

      // HttpOnly flag (boolean)
      if (options.httpOnly === true) {
        parts.push("HttpOnly");
      }

      // SameSite
      if (options.sameSite) {
        const sameSiteValue = String(options.sameSite);
        // Validate sameSite values
        if (sameSiteValue === "Strict" || sameSiteValue === "Lax" || sameSiteValue === "None") {
          parts.push(`SameSite=${sameSiteValue}`);
        }
      }
    }

    // Join attributes with "; " and append to headers
    const cookieString = parts.join("; ");
    this._headers.append("set-cookie", cookieString);

    return this;
  }

  clearCookie(name: string, options?: any): this {
    // Clear cookie by setting it with empty value and expiration
    this.cookie(name, "", {
      ...options,
      expires: new Date(0),
      maxAge: 0,
    });
    return this;
  }

  send(body?: any): this {
    if (this._sent) return this;
    this._body = body;
    this._sent = true;
    return this;
  }

  json(body: any): this {
    this._headers.set("content-type", "application/json");
    this._body = JSON.stringify(body);
    this._sent = true;
    return this;
  }

  sendFile(path: string, options?: any, callback?: any): this {
    // TODO: implement file sending
    throw new Error("sendFile not yet implemented");
  }

  sendStatus(statusCode: number): this {
    this._statusCode = statusCode;
    this._body = this._statusCode.toString();
    this._sent = true;
    return this;
  }

  redirect(status: number | string, url?: string): this {
    if (typeof status === "string") {
      url = status;
      status = 302;
    }
    this._statusCode = status as number;
    this._headers.set("location", url!);
    this._body = `Redirecting to ${url}`;
    this._sent = true;
    return this;
  }

  render(view: string, locals?: any, callback?: any): this {
    // TODO: implement view rendering
    throw new Error("render not yet implemented");
  }

  end(chunk?: any, encoding?: string, cb?: any): this {
    if (chunk) {
      this._body = chunk;
    }
    this._sent = true;
    return this;
  }

  // Convert to Bun Response
  toBunResponse(): Response {
    let body: BodyInit | null = null;

    if (this._body !== null) {
      if (typeof this._body === "string") {
        body = this._body;
      } else if (this._body instanceof Uint8Array || this._body instanceof ArrayBuffer) {
        body = this._body;
      } else {
        body = String(this._body);
      }
    }

    return new Response(body, {
      status: this._statusCode,
      headers: this._headers,
    });
  }
}

// Middleware function type
type Middleware = (req: ExpressRequest, res: ExpressResponse, next: (err?: any) => void) => void | Promise<void>;

// Route handler type
type RouteHandler = Middleware;

// Router class
class Router {
  private _stack: Array<{
    method?: string;
    path?: string | RegExp;
    handlers: Middleware[];
  }> = [];

  use(path: string | Middleware, ...handlers: Middleware[]): this {
    if (typeof path === "function") {
      handlers.unshift(path);
      path = "/";
    }
    this._stack.push({
      path: path as string,
      handlers,
    });
    return this;
  }

  get(path: string | RegExp, ...handlers: RouteHandler[]): this {
    return this._route("GET", path, handlers);
  }

  post(path: string | RegExp, ...handlers: RouteHandler[]): this {
    return this._route("POST", path, handlers);
  }

  put(path: string | RegExp, ...handlers: RouteHandler[]): this {
    return this._route("PUT", path, handlers);
  }

  delete(path: string | RegExp, ...handlers: RouteHandler[]): this {
    return this._route("DELETE", path, handlers);
  }

  patch(path: string | RegExp, ...handlers: RouteHandler[]): this {
    return this._route("PATCH", path, handlers);
  }

  all(path: string | RegExp, ...handlers: RouteHandler[]): this {
    return this._route(undefined, path, handlers);
  }

  private _route(method: string | undefined, path: string | RegExp, handlers: RouteHandler[]): this {
    // Validate route path to mitigate ReDoS risk
    if (typeof path === "string") {
      // Limit parameter count to prevent excessive regex complexity
      const paramCount = (path.match(/:(\w+)/g) || []).length;
      if (paramCount > 50) {
        throw new Error(`Route path has too many parameters (${paramCount}). Maximum allowed is 50.`);
      }

      // Reject paths with excessive wildcards that could cause backtracking
      const wildcardCount = (path.match(/\*/g) || []).length;
      if (wildcardCount > 10) {
        throw new Error(`Route path has too many wildcards (${wildcardCount}). Maximum allowed is 10.`);
      }

      // Reject extremely long paths that could cause issues
      if (path.length > 1000) {
        throw new Error(`Route path is too long (${path.length} characters). Maximum allowed is 1000.`);
      }
    }

    this._stack.push({
      method,
      path,
      handlers,
    });
    return this;
  }

  get stack() {
    return this._stack;
  }
}

// Express Application class
class ExpressApp {
  private _router: Router = new Router();
  private _settings: Record<string, any> = {
    "case sensitive routing": false,
    "strict routing": false,
  };

  constructor() {}

  // Application settings
  set(setting: string, val?: any): this | any {
    if (arguments.length === 1) {
      return this._settings[setting];
    }
    this._settings[setting] = val;
    return this;
  }

  // TypeScript overloads for get() method
  // Overload 1: Get application setting
  get(setting: string): any;
  // Overload 2: Register GET route
  get(path: string | RegExp, ...handlers: RouteHandler[]): this;
  // Implementation
  get(settingOrPath: string | RegExp, ...handlers: RouteHandler[]): any | this {
    // If first argument is a string and only one argument, treat as setting getter
    if (typeof settingOrPath === "string" && arguments.length === 1) {
      return this._settings[settingOrPath];
    }
    // Otherwise, treat as route registration
    return this._router.get(settingOrPath as string | RegExp, ...handlers);
  }

  enable(setting: string): this {
    this._settings[setting] = true;
    return this;
  }

  disable(setting: string): this {
    this._settings[setting] = false;
    return this;
  }

  // Middleware and routing
  use(path: string | Middleware, ...handlers: Middleware[]): this {
    return this._router.use(path as any, ...handlers);
  }

  post(path: string | RegExp, ...handlers: RouteHandler[]): this {
    return this._router.post(path, ...handlers);
  }

  put(path: string | RegExp, ...handlers: RouteHandler[]): this {
    return this._router.put(path, ...handlers);
  }

  delete(path: string | RegExp, ...handlers: RouteHandler[]): this {
    return this._router.delete(path, ...handlers);
  }

  patch(path: string | RegExp, ...handlers: RouteHandler[]): this {
    return this._router.patch(path, ...handlers);
  }

  all(path: string | RegExp, ...handlers: RouteHandler[]): this {
    return this._router.all(path, ...handlers);
  }

  // Bun.serve integration
  async fetch(bunRequest: Request, server?: Server): Promise<Response> {
    const req = new ExpressRequest(bunRequest);
    const res = new ExpressResponse();

    try {
      // Parse body if present
      // Note: Request body can only be read once, so we need to check method first
      const method = bunRequest.method;
      if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
        const contentType = bunRequest.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          try {
            req.body = await bunRequest.json();
          } catch (e) {
            // Invalid JSON, leave body as null
            req.body = null;
          }
        } else if (contentType.includes("text/")) {
          try {
            req.body = await bunRequest.text();
          } catch (e) {
            req.body = null;
          }
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          try {
            const text = await bunRequest.text();
            const params = new URLSearchParams(text);
            req.body = {};
            for (const [key, value] of params.entries()) {
              req.body[key] = value;
            }
          } catch (e) {
            req.body = null;
          }
        }
      }

      await this._handleRequest(req, res);
    } catch (error) {
      // Error handling
      if (!res.headersSent) {
        res.status(500);
        res.send("Internal Server Error");
      }
    }

    return res.toBunResponse();
  }

  private async _handleRequest(req: ExpressRequest, res: ExpressResponse): Promise<void> {
    const url = new URL(req._bun.url);
    let pathname = url.pathname;
    const method = req.method;

    // Apply strict routing setting
    const strictRouting = this._settings["strict routing"];
    if (!strictRouting) {
      // Remove trailing slash for matching (but preserve original)
      if (pathname !== "/" && pathname.endsWith("/")) {
        pathname = pathname.slice(0, -1);
      }
    }

    // Find matching route
    for (const layer of this._router.stack) {
      if (layer.method && layer.method !== method) {
        continue;
      }

      const path = layer.path || "/";
      let matched = false;
      let params: Record<string, string> = {};

      if (typeof path === "string") {
        // Simple path matching
        if (path === "*" || path === "/*") {
          matched = true;
        } else if (path.includes(":")) {
          // Parameter matching
          // ReDoS mitigation: limit parameter count and pattern complexity
          const paramCount = (path.match(/:(\w+)/g) || []).length;
          if (paramCount > 50) {
            // Skip matching if parameter count exceeds safe limit
            continue;
          }

          const pathPattern = path
            .replace(/\./g, "\\.")
            .replace(/:(\w+)/g, "([^/]+)")
            .replace(/\*/g, ".*");

          // Additional safety: limit pattern length to prevent excessive regex complexity
          if (pathPattern.length > 2000) {
            continue;
          }

          try {
            const regex = new RegExp(`^${pathPattern}$`);
            const match = pathname.match(regex);
            if (match) {
              matched = true;
              const paramNames = path.match(/:(\w+)/g) || [];
              for (let i = 0; i < paramNames.length; i++) {
                const paramName = paramNames[i].slice(1);
                params[paramName] = decodeURIComponent(match[i + 1]);
              }
            }
          } catch (e) {
            // Skip invalid regex patterns
            continue;
          }
        } else {
          // Exact or prefix match
          const caseSensitive = this._settings["case sensitive routing"];
          const comparePath = caseSensitive ? pathname : pathname.toLowerCase();
          const comparePattern = caseSensitive ? path : path.toLowerCase();

          // Special case: "/" matches all paths
          if (comparePattern === "/") {
            // Root path matches any path that starts with "/"
            if (comparePath.startsWith("/")) {
              matched = true;
            }
          } else if (comparePath === comparePattern || comparePath.startsWith(comparePattern + "/")) {
            matched = true;
          }
        }
      } else if (path instanceof RegExp) {
        const match = pathname.match(path);
        if (match) {
          matched = true;
          // Extract regex groups as params
          for (let i = 1; i < match.length; i++) {
            params[i - 1] = match[i];
          }
        }
      }

      if (matched) {
        req.params = { ...req.params, ...params };

        // Execute handlers
        for (const handler of layer.handlers) {
          let nextCalled = false;
          let nextError: any = null;
          const wasHeadersSentBefore = res.headersSent;

          await new Promise<void>((resolve, reject) => {
            const next = (err?: any) => {
              if (err) {
                nextError = err;
                nextCalled = true;
                reject(err);
              } else {
                nextCalled = true;
                resolve();
              }
            };

            try {
              const result = handler(req, res, next);
              if (result instanceof Promise) {
                result
                  .then(() => {
                    // If handler completed and didn't call next() or send response,
                    // it's likely an async handler that forgot to call next()
                    // In Express, this would hang, but we'll continue for compatibility
                    if (!nextCalled && !res.headersSent) {
                      nextCalled = true;
                      resolve();
                    } else if (nextCalled) {
                      // next() was already called
                      resolve();
                    }
                  })
                  .catch(err => {
                    nextError = err;
                    reject(err);
                  });
              } else {
                // Synchronous handler
                // Check if response was sent or next was called
                if (res.headersSent && !wasHeadersSentBefore) {
                  // Response was sent, handler is done
                  nextCalled = true;
                  resolve();
                } else if (nextCalled) {
                  // next() was called
                  resolve();
                } else {
                  // Handler returned without calling next() or sending response
                  // This is technically an error in Express, but we'll continue
                  // to be more forgiving
                  nextCalled = true;
                  resolve();
                }
              }
            } catch (error) {
              nextError = error;
              reject(error);
            }
          });

          // If there was an error, stop processing
          if (nextError) {
            throw nextError;
          }

          // If response was sent, stop processing
          if (res.headersSent) {
            return;
          }

          // Continue to next handler if next() was called
          // If next() wasn't called but response wasn't sent, continue anyway
          // (this is more forgiving than Express, but needed for compatibility)
        }
      }
    }

    // No route matched
    if (!res.headersSent) {
      res.status(404);
      res.send("Not Found");
    }
  }

  // Express.listen() compatibility - returns a Bun.serve server
  listen(port?: number, callback?: () => void): Server {
    const server = Bun.serve({
      port: port || 3000,
      fetch: this.fetch.bind(this),
    });

    if (callback) {
      callback();
    }

    return server as any;
  }
}

// Factory function
function express(): ExpressApp {
  return new ExpressApp();
}

// Attach Router to express function
express.Router = Router;

// Only default export for builtin modules
export default express;
