/**
 * Adapter for Node.js http.createServer() instrumentation
 *
 * Bridges Node.js IncomingMessage/ServerResponse to BunGenericInstrumentation's
 * attribute-based API using .once() event listeners.
 */

import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_URL_FULL,
  ATTR_URL_SCHEME,
  ATTR_ERROR_TYPE,
  ATTR_EXCEPTION_MESSAGE,
} from "../semconv";
import type { NativeInstrument } from "bun";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseUrlAndHost } from "../url-utils";
import { BunGenericInstrumentation } from "./BunGenericInstrumentation";

/**
 * Extract content-length from ServerResponse
 */
function extractContentLength(response: ServerResponse): number {
  const contentLength = response.getHeader?.("content-length");

  if (typeof contentLength === "number") {
    return contentLength;
  }

  if (typeof contentLength === "string") {
    const parsed = parseInt(contentLength, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

/**
 * Adapter for Node.js http.createServer()
 *
 * Maps Node.js request/response objects to attribute-based API using .once() listeners.
 *
 * @example
 * ```typescript
 * const adapter = new BunNodeHttpCreateServerAdapter({
 *   name: "bun-node-http",
 *   version: "0.1.0",
 *   kind: "node",
 *   trace: {
 *     start: ["http.request.method", "url.path"],
 *     end: ["http.response.status_code"],
 *   },
 * });
 *
 * adapter.setTracerProvider(tracerProvider);
 * adapter.enable();
 * ```
 */
export class BunNodeHttpCreateServerAdapter extends BunGenericInstrumentation {
  protected _createNativeInstrument(): NativeInstrument {
    // Get the generic API from parent
    const api = super._createNativeInstrument();

    return {
      ...api,

      /**
       * Handle Node.js http.createServer() request start
       *
       * Maps IncomingMessage/ServerResponse to attributes and sets up
       * .once() listeners for lifecycle events.
       */
      onOperationStart: (id, attrs) => {
        const nodeRequest = attrs["http_req"] as IncomingMessage;
        const nodeResponse = attrs["http_res"] as ServerResponse;

        if (!nodeRequest || !nodeResponse) {
          // Not a Node.js server request, skip
          return;
        }

        // CRITICAL: Store OpId on response for inject hook
        // Without this, _http_server.ts falls back to 0, which auto-increments!
        (nodeResponse as any)._telemetry_op_id = id;

        // Extract attributes from IncomingMessage

        const method = nodeRequest.method ?? "UNKNOWN";
        const host =
          (Array.isArray(nodeRequest.headers.host) ? nodeRequest.headers.host[0] : nodeRequest.headers.host) ||
          "localhost";
        const protocol = (nodeRequest.socket as any)?.encrypted ? "https" : "http";
        const pathname = nodeRequest.url || "/";
        const fullUrl = `${protocol}://${host}${pathname}`;

        const userAgent = nodeRequest.headers["user-agent"];
        const contentLengthHeader = nodeRequest.headers["content-length"];
        const contentLengthStr = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader;
        const contentLength = contentLengthStr ? Number(contentLengthStr) : undefined;

        const mappedAttrs: Record<string, string | number | boolean> = {
          [ATTR_URL_FULL]: fullUrl,
          [ATTR_HTTP_REQUEST_METHOD]: method,
          [ATTR_URL_SCHEME]: protocol,
          ...parseUrlAndHost(pathname, host),
        };
        if (userAgent) mappedAttrs["http.user_agent"] = Array.isArray(userAgent) ? userAgent[0] : userAgent;
        if (typeof contentLength === "number" && Number.isFinite(contentLength)) {
          mappedAttrs["http.request_content_length"] = contentLength;
        }

        // Add request headers if configured
        if (this._config.trace?.start) {
          for (const attrKey of this._config.trace.start) {
            if (attrKey.startsWith("http.request.header.")) {
              const headerName = attrKey.replace("http.request.header.", "");
              const value = nodeRequest.headers[headerName];
              if (value !== undefined) {
                mappedAttrs[attrKey] = Array.isArray(value) ? value[0] : String(value);
              }
            }
          }
        }

        // Call generic API with mapped attributes
        api.onOperationStart!(id, mappedAttrs);

        // Setup .once() listeners for lifecycle events

        // Error: Request failed
        nodeResponse.once("error", (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
          api.onOperationError!(id, {
            [ATTR_ERROR_TYPE]: "Error",
            [ATTR_EXCEPTION_MESSAGE]: message,
          });
        });

        // Close: Client aborted
        nodeResponse.once("close", () => {
          // Only fire if not already finished
          if (!nodeResponse.writableFinished) {
            api.onOperationError!(id, {
              [ATTR_ERROR_TYPE]: "ClientAbort",
              [ATTR_EXCEPTION_MESSAGE]: "Request aborted",
            });
          }
        });

        // Timeout: Request timeout
        nodeResponse.once("timeout", () => {
          api.onOperationError!(id, {
            [ATTR_ERROR_TYPE]: "Timeout",
            [ATTR_EXCEPTION_MESSAGE]: "Request timeout",
          });
        });

        // Finish: Request completed successfully
        nodeResponse.once("finish", () => {
          const statusCode = nodeResponse.statusCode ?? 500;
          const contentLength = extractContentLength(nodeResponse);

          // Extract final attributes
          const endAttrs: Record<string, any> = {
            "http.response.status_code": statusCode,
          };

          if (contentLength > 0) {
            endAttrs["http.response.body.size"] = contentLength;
          }

          // Add response headers if configured
          if (this._config.trace?.end) {
            for (const attrKey of this._config.trace.end) {
              if (attrKey.startsWith("http.response.header.")) {
                const headerName = attrKey.replace("http.response.header.", "");
                const value = nodeResponse.getHeader(headerName);
                if (value !== undefined) {
                  endAttrs[attrKey] = Array.isArray(value) ? value[0] : String(value);
                }
              }
            }
          }

          // Call generic API with final attributes
          api.onOperationEnd!(id, endAttrs);
        });
      },

      // Passthrough - works the same
      onOperationInject: api.onOperationInject,
    };
  }
}
