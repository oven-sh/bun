import type * as s from "stream";
import type { Readable } from "node:stream";
import type { Stream } from "node:stream"; // Import Stream type

// Users may override the global fetch implementation, so we need to ensure these are the originals.
const bindings = $cpp("NodeFetch.cpp", "createNodeFetchInternalBinding");
const WebResponse: typeof globalThis.Response = bindings[0];
const WebRequest: typeof globalThis.Request = bindings[1];
const Blob: typeof globalThis.Blob = bindings[2];
const WebHeaders: typeof globalThis.Headers = bindings[3];
const FormData: typeof globalThis.FormData = bindings[4];
const File: typeof globalThis.File = bindings[5];
const nativeFetch = Bun.fetch;

// Define missing standard types if not globally available
// Use Bun's BodyInit type for compatibility within the Bun environment.
type BodyInit = Bun.BodyInit;
type RequestInfo = globalThis.Request | string;


// node-fetch extends from URLSearchParams in their implementation...
// https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/headers.js#L44
class Headers extends WebHeaders {
  raw(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    // Group values by lowercase key from entries()
    // This correctly handles multi-value headers like Set-Cookie.
    for (const [key, value] of this.entries()) {
      const lowerKey = key.toLowerCase();
      if (!result[lowerKey]) {
        result[lowerKey] = [];
      }
      result[lowerKey].push(value);
    }
    return result;
  }

  // node-fetch inherits this due to URLSearchParams.
  // it also throws if you try to use it.
  sort() {
    // This method does not exist on Headers, but is inherited via prototype chain in node-fetch.
    // Throwing here maintains compatibility with node-fetch's behavior.
    throw new TypeError("Headers.sort is not supported");
  }
}

const _kBody = Symbol.for("node-fetch::body");
const _kHeaders = Symbol.for("node-fetch::headers");
const HeadersPrototype = Headers.prototype;

class Response extends WebResponse {
  // Lazily initialized Node.js stream adapter
  [_kBody]: s.Readable | null = null;
  // Lazily initialized custom Headers wrapper
  [_kHeaders]!: Headers; // Initialized in the getter

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    const { Readable, Stream } = require("node:stream");
    let processedBody: BodyInit | null | undefined = body;
    // Check if body is a Node.js stream-like object
    if (body && typeof body === "object" && !(body instanceof Blob) && !(body instanceof ReadableStream) && body instanceof Stream && typeof (body as any).pipe === 'function') {
        // Cast to 'Readable' is needed for Readable.toWeb.
        // Readable.toWeb returns a ReadableStream, which is compatible with BodyInit.
        // Cast to `any` because Node.js ReadableStream is not assignable to Bun's internal ReadableStream type
        processedBody = Readable.toWeb(body as unknown as Readable) as any; // Use unknown cast to fix TS2352 and any cast for TS2345
    }
    // Pass the potentially converted body to the super constructor.
    // The super constructor expects Bun.BodyInit | null | undefined.
    // Our processedBody is either the original body or a ReadableStream.
    // We need to ensure the original body types are also compatible or handled.
    // Assuming the base WebResponse constructor handles standard BodyInit types.
    super(processedBody, init);
  }

  // Override body getter to provide a Node.js Readable stream
  // @ts-ignore TS2611: 'body' is defined as a property in class 'Response', but is overridden here in 'Response' as an accessor.
  get body(): s.Readable | null {
    // If the Node.js stream adapter hasn't been created yet
    if (this[_kBody] === null) {
      // Get the underlying Web Stream from the base Response
      const webBody = (this as unknown as globalThis.Response).body;
      // If there's no body, return null
      if (webBody === null) {
        return null;
      }
      // Create the Node.js Readable stream adapter using the internal utility
      // This happens only once when the body is first accessed.
      // Cast `this` to unknown first to satisfy the type checker regarding potential overlaps.
      this[_kBody] = new (require("internal/webstreams_adapters")._ReadableFromWeb)({} as any, webBody);
    }
    return this[_kBody];
  }

  // Override headers getter to return our custom Headers instance
  get headers(): Headers {
    // If the custom Headers wrapper hasn't been created yet
    if (!this[_kHeaders]) {
      // Create a new instance of our Headers class, passing the base headers.
      // This ensures the correct prototype and methods like raw() are available.
      // Cast `this` to unknown first to satisfy the type checker regarding potential overlaps.
      this[_kHeaders] = new Headers((this as unknown as globalThis.Response).headers);
    }
    return this[_kHeaders];
  }

  // Override clone to ensure the cloned object is also an instance of our Response
  // @ts-ignore TS2416 Property 'clone' in type 'Response' is not assignable to the same property in base type 'Response'.
  // @ts-ignore TS2425 Class 'Response' defines instance member property 'clone', but extended class 'Response' defines it as instance member function.
  clone(): Response {
    // Clone the underlying WebResponse object using prototype call
    // Cast `this` to unknown first to satisfy the type checker regarding potential overlaps.
    const cloned = WebResponse.prototype.clone.call(this as unknown as globalThis.Response);
    // Set the prototype of the cloned object to our custom Response prototype
    Object.setPrototypeOf(cloned, ResponsePrototype);
    // Reset the lazy-initialized properties on the clone. They will be recreated
    // if accessed on the cloned instance.
    (cloned as Response)[_kBody] = null;
    // _kHeaders doesn't need explicit reset; the getter will create it on demand.
    // Cast needed because the base clone returns globalThis.Response, but we need our extended type.
    return cloned as Response;
  }

  // Override standard body methods to ensure lazy body initialization logic runs if needed
  // @ts-ignore TS2425 Class 'Response' defines instance member property 'arrayBuffer', but extended class 'Response' defines it as instance member function.
  async arrayBuffer(): Promise<ArrayBuffer> {
    this.body; // Access getter to potentially initialize Node stream adapter
    // Use prototype call instead of super
    // Cast `this` to unknown first to satisfy the type checker regarding potential overlaps.
    return await WebResponse.prototype.arrayBuffer.call(this as unknown as globalThis.Response);
  }

  // @ts-ignore TS2416 Property 'blob' in type 'Response' is not assignable to the same property in base type 'Response'.
  // @ts-ignore TS2425 Class 'Response' defines instance member property 'blob', but extended class 'Response' defines it as instance member function.
  async blob(): Promise<Blob> {
    this.body; // Access getter
    // Use prototype call and cast needed because globalThis.Blob might lack Bun-specific extensions expected by the local alias
    // Cast `this` to unknown first to satisfy the type checker regarding potential overlaps.
    const result = await WebResponse.prototype.blob.call(this as unknown as globalThis.Response);
    // Cast to our aliased Blob type (which should be globalThis.Blob)
    return result as Blob;
  }

  // @ts-ignore TS2416 Property 'formData' in type 'Response' is not assignable to the same property in base type 'Response'.
  // @ts-ignore TS2425 Class 'Response' defines instance member property 'formData', but extended class 'Response' defines it as instance member function.
  async formData(): Promise<FormData> {
    this.body; // Access getter
    // Use prototype call and cast needed due to potential discrepancies between native FormData and aliased/extended FormData types
    // Cast `this` to unknown first to satisfy the type checker regarding potential overlaps.
    const result = await WebResponse.prototype.formData.call(this as unknown as globalThis.Response);
    // Cast to our aliased FormData type
    return result as FormData;
  }

  // @ts-ignore TS2425 Class 'Response' defines instance member property 'json', but extended class 'Response' defines it as instance member function.
  async json(): Promise<any> {
    this.body; // Access getter
    // Use prototype call
    // Cast `this` to unknown first to satisfy the type checker regarding potential overlaps.
    return await WebResponse.prototype.json.call(this as unknown as globalThis.Response);
  }

  // node-fetch compatibility method
  async buffer(): Promise<Buffer> {
    this.body; // Access getter
    // Use prototype call for arrayBuffer
    // Cast `this` to unknown first to satisfy the type checker regarding potential overlaps.
    const ab = await WebResponse.prototype.arrayBuffer.call(this as unknown as globalThis.Response);
    // Use Bun's internal Buffer constructor ($Buffer)
    return new $Buffer(ab);
  }

  // @ts-ignore TS2425 Class 'Response' defines instance member property 'text', but extended class 'Response' defines it as instance member function.
  async text(): Promise<string> {
    this.body; // Access getter
    // Use prototype call
    // Cast `this` to unknown first to satisfy the type checker regarding potential overlaps.
    return await WebResponse.prototype.text.call(this as unknown as globalThis.Response);
  }

  // Override type getter for node-fetch compatibility
  // @ts-ignore TS2611: 'type' is defined as a property in class 'Response', but is overridden here in 'Response' as an accessor.
  get type(): ResponseType | "error" | "default" {
    // node-fetch returns 'error' for non-ok responses, 'default' otherwise.
    // Cast `this` to unknown first to satisfy the type checker regarding potential overlaps.
    if (!(this as unknown as globalThis.Response).ok) {
      return "error";
    }
    // The standard 'type' property exists on the base Response.
    // node-fetch seems to map basic/cors/opaque/default to 'default'.
    // We return 'default' to match node-fetch, ignoring the actual base type.
    return "default";
  }
}
const ResponsePrototype = Response.prototype;

const _kUrl = Symbol.for("node-fetch::url");

// Custom Request class for node-fetch compatibility quirks
class Request extends WebRequest {
  // Stores the original input string if it was treated as a relative path
  [_kUrl]?: string;

  constructor(input: RequestInfo | URL, init?: RequestInit) {
    let requestInput: globalThis.Request | string;

    // Handle string inputs, allowing relative paths like node-fetch does
    if (typeof input === "string") {
      try {
        // Check if it's a full URL, but don't create the URL object yet
        // to avoid potential side effects or different parsing behavior.
        // The native Request constructor will handle URL parsing.
        new URL(input);
        requestInput = input;
        // Use 'as any' to satisfy constructor overloads which might be complex.
        super(requestInput as any, init); // Construct with the valid URL string
      } catch {
        // If new URL() fails, treat as a relative path against a dummy base
        const url = new URL(input, "http://localhost/");
        requestInput = url.toString(); // Use the resolved URL for the base constructor
        // Use 'as any' to satisfy constructor overloads.
        super(requestInput as any, init);
        this[_kUrl] = input; // Store the original relative path string
      }
    } else if (input instanceof URL) {
      // If input is a URL object, convert to string for the base constructor
      requestInput = input.toString();
      // Use 'as any' to satisfy constructor overloads.
      super(requestInput as any, init);
    } else {
      // If input is already a Request object, pass it directly
      requestInput = input;
      // Use 'as any' to satisfy constructor overloads.
      super(requestInput as any, init);
    }
  }

  // Override url getter to return the original relative path if one was stored
  // @ts-ignore TS2611: 'url' is defined as a property in class 'Request', but is overridden here in 'Request' as an accessor.
  get url(): string {
    // Access base property via `this` cast to the actual base type, not `super`
    // Cast `this` to unknown first to satisfy the type checker regarding potential overlaps.
    return this[_kUrl] ?? (this as unknown as globalThis.Request).url;
  }
}

/**
 * `node-fetch` compatibility wrapper around Bun's native fetch.
 * Converts Node.js streams in the request body to Web Streams.
 * Returns an instance of the custom `Response` class with Node.js stream support.
 */
async function fetch(url: RequestInfo | URL, init?: RequestInit & { body?: any }): Promise<Response> {
  let processedInit = init;
  // Check if the body is a Node.js Readable stream
  if (init?.body) {
    const { Readable, Stream } = require("node:stream");
    const body = init.body; // Local variable for clarity
    // Check if body is a Node.js stream-like object
    if (body && typeof body === 'object' && !(body instanceof Blob) && !(body instanceof ReadableStream) && body instanceof Stream && typeof (body as any).pipe === 'function') {
      // Convert Node.js stream to Web Stream
      const webStream = Readable.toWeb(body as unknown as Readable); // Cast is safe here
      // Cast to `any` because Node.js ReadableStream is not assignable to Bun's internal ReadableStream type
      processedInit = { ...init, body: webStream as any }; // webStream is ReadableStream, compatible with BodyInit
    }
    // If it's not a Node.js stream, assume nativeFetch handles other BodyInit types
  }

  // Call Bun's native fetch implementation
  const response = await nativeFetch(url, processedInit);
  // Set the prototype of the returned response to our custom Response prototype
  Object.setPrototypeOf(response, ResponsePrototype);
  // Cast the result to our extended Response type
  return response as unknown as Response; // Use unknown cast
}

// Custom AbortError class matching node-fetch's structure
class AbortError extends DOMException {
  constructor(message: string = "The operation was aborted.") {
    // Pass message and name to the DOMException constructor
    // Standard DOMException constructor takes (message?, name?)
    // Workaround for TS2554: Call super() and set properties manually
    super();
    Object.defineProperty(this, 'message', { value: message, enumerable: false, writable: true, configurable: true });
    Object.defineProperty(this, 'name', { value: "AbortError", enumerable: false, writable: false, configurable: true });
  }
}

// Base error class for fetch errors, matching node-fetch
class FetchBaseError extends Error {
  type: string;
  constructor(message: string, type: string) {
    super(message);
    this.type = type;
    // Set the error name to the class name
    Object.defineProperty(this, 'name', {
        value: new.target.name,
        enumerable: false,
        writable: false,
        configurable: true,
    });
    // Capture stack trace if the V8 API is available
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// Specific fetch error class, potentially holding a system error code
class FetchError extends FetchBaseError {
  code?: string; // Optional system error code

  constructor(message: string, type: string, systemError?: Error & { code?: string }) {
    super(message, type);
    // Copy the error code if the systemError exists and has one
    if (systemError?.code) {
      this.code = systemError.code;
    }
  }
}

// Helper function to create a File object from a path (async)
// Casts BunFile to File, assuming compatibility or consumer tolerance for name?: string
function blobFrom(path: string | URL, options?: BlobPropertyBag): Promise<File> {
  // Cast Bun.file result to File type alias
  return Promise.resolve(Bun.file(path, options) as File);
}

// Helper function to create a File object from a path (sync)
// Casts BunFile to File
function blobFromSync(path: string | URL, options?: BlobPropertyBag): File {
  // Cast Bun.file result to File type alias
  return Bun.file(path, options) as File;
}

// Aliases for blobFrom/blobFromSync for node-fetch compatibility
var fileFrom = blobFrom;
var fileFromSync = blobFromSync;

// Helper function to check if an HTTP status code is a redirect
function isRedirect(code: number): boolean {
  return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
}

// Export the fetch function along with compatibility classes and helpers
export default Object.assign(fetch, {
  AbortError,
  Blob, // Re-export Blob from bindings
  FetchBaseError,
  FetchError,
  File, // Re-export File from bindings
  FormData, // Re-export FormData from bindings
  Headers, // Export our custom Headers
  Request, // Export our custom Request
  Response, // Export our custom Response
  blobFrom,
  blobFromSync,
  fileFrom,
  fileFromSync,
  isRedirect,
  fetch, // Export fetch itself again
  default: fetch, // Export fetch as default
});