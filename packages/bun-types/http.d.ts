/**
 * To use the HTTP server and client one must `require('http')`.
 *
 * The HTTP interfaces in Node.js are designed to support many features
 * of the protocol which have been traditionally difficult to use.
 * In particular, large, possibly chunk-encoded, messages. The interface is
 * careful to never buffer entire requests or responses, so the
 * user is able to stream data.
 *
 * HTTP message headers are represented by an object like this:
 *
 * ```js
 * { 'content-length': '123',
 *   'content-type': 'text/plain',
 *   'connection': 'keep-alive',
 *   'host': 'example.com',
 *   'accept': '*' }
 * ```
 *
 * Keys are lowercased. Values are not modified.
 *
 * In order to support the full spectrum of possible HTTP applications, the Node.js
 * HTTP API is very low-level. It deals with stream handling and message
 * parsing only. It parses a message into headers and body but it does not
 * parse the actual headers or the body.
 *
 * See `message.headers` for details on how duplicate headers are handled.
 *
 * The raw headers as they were received are retained in the `rawHeaders`property, which is an array of `[key, value, key2, value2, ...]`. For
 * example, the previous message header object might have a `rawHeaders`list like the following:
 *
 * ```js
 * [ 'ConTent-Length', '123456',
 *   'content-LENGTH', '123',
 *   'content-type', 'text/plain',
 *   'CONNECTION', 'keep-alive',
 *   'Host', 'example.com',
 *   'accepT', '*' ]
 * ```
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/http.js)
 */
declare module "http" {
  import * as stream from "node:stream";
  // incoming headers will never contain number
  interface IncomingHttpHeaders extends Dict<string | string[]> {
    accept?: string | undefined;
    "accept-language"?: string | undefined;
    "accept-patch"?: string | undefined;
    "accept-ranges"?: string | undefined;
    "access-control-allow-credentials"?: string | undefined;
    "access-control-allow-headers"?: string | undefined;
    "access-control-allow-methods"?: string | undefined;
    "access-control-allow-origin"?: string | undefined;
    "access-control-expose-headers"?: string | undefined;
    "access-control-max-age"?: string | undefined;
    "access-control-request-headers"?: string | undefined;
    "access-control-request-method"?: string | undefined;
    age?: string | undefined;
    allow?: string | undefined;
    "alt-svc"?: string | undefined;
    authorization?: string | undefined;
    "cache-control"?: string | undefined;
    connection?: string | undefined;
    "content-disposition"?: string | undefined;
    "content-encoding"?: string | undefined;
    "content-language"?: string | undefined;
    "content-length"?: string | undefined;
    "content-location"?: string | undefined;
    "content-range"?: string | undefined;
    "content-type"?: string | undefined;
    cookie?: string | undefined;
    date?: string | undefined;
    etag?: string | undefined;
    expect?: string | undefined;
    expires?: string | undefined;
    forwarded?: string | undefined;
    from?: string | undefined;
    host?: string | undefined;
    "if-match"?: string | undefined;
    "if-modified-since"?: string | undefined;
    "if-none-match"?: string | undefined;
    "if-unmodified-since"?: string | undefined;
    "last-modified"?: string | undefined;
    location?: string | undefined;
    origin?: string | undefined;
    pragma?: string | undefined;
    "proxy-authenticate"?: string | undefined;
    "proxy-authorization"?: string | undefined;
    "public-key-pins"?: string | undefined;
    range?: string | undefined;
    referer?: string | undefined;
    "retry-after"?: string | undefined;
    "sec-websocket-accept"?: string | undefined;
    "sec-websocket-extensions"?: string | undefined;
    "sec-websocket-key"?: string | undefined;
    "sec-websocket-protocol"?: string | undefined;
    "sec-websocket-version"?: string | undefined;
    "set-cookie"?: string[] | undefined;
    "strict-transport-security"?: string | undefined;
    tk?: string | undefined;
    trailer?: string | undefined;
    "transfer-encoding"?: string | undefined;
    upgrade?: string | undefined;
    "user-agent"?: string | undefined;
    vary?: string | undefined;
    via?: string | undefined;
    warning?: string | undefined;
    "www-authenticate"?: string | undefined;
  }
  // outgoing headers allows numbers (as they are converted internally to strings)
  type OutgoingHttpHeader = number | string | string[];
  interface OutgoingHttpHeaders extends Dict<OutgoingHttpHeader> {}
  interface ClientRequestArgs {
    signal?: AbortSignal | undefined;
    protocol?: string | null | undefined;
    host?: string | null | undefined;
    hostname?: string | null | undefined;
    family?: number | undefined;
    port?: number | string | null | undefined;
    defaultPort?: number | string | undefined;
    localAddress?: string | undefined;
    socketPath?: string | undefined;
    /**
     * @default 8192
     */
    maxHeaderSize?: number | undefined;
    method?: string | undefined;
    path?: string | null | undefined;
    headers?: OutgoingHttpHeaders | undefined;
    auth?: string | null | undefined;
    timeout?: number | undefined;
    setHost?: boolean | undefined;
  }
  interface InformationEvent {
    statusCode: number;
    statusMessage: string;
    httpVersion: string;
    httpVersionMajor: number;
    httpVersionMinor: number;
    headers: IncomingHttpHeaders;
    rawHeaders: string[];
  }
  /**
   * This object is created internally and returned from {@link request}. It
   * represents an _in-progress_ request whose header has already been queued. The
   * header is still mutable using the `setHeader(name, value)`,`getHeader(name)`, `removeHeader(name)` API. The actual header will
   * be sent along with the first data chunk or when calling `request.end()`.
   *
   * To get the response, add a listener for `'response'` to the request object.`'response'` will be emitted from the request object when the response
   * headers have been received. The `'response'` event is executed with one
   * argument which is an instance of {@link IncomingMessage}.
   *
   * During the `'response'` event, one can add listeners to the
   * response object; particularly to listen for the `'data'` event.
   *
   * If no `'response'` handler is added, then the response will be
   * entirely discarded. However, if a `'response'` event handler is added,
   * then the data from the response object **must** be consumed, either by
   * calling `response.read()` whenever there is a `'readable'` event, or
   * by adding a `'data'` handler, or by calling the `.resume()` method.
   * Until the data is consumed, the `'end'` event will not fire. Also, until
   * the data is read it will consume memory that can eventually lead to a
   * 'process out of memory' error.
   *
   * For backward compatibility, `res` will only emit `'error'` if there is an`'error'` listener registered.
   *
   * Node.js does not check whether Content-Length and the length of the
   * body which has been transmitted are equal or not.
   */
  class ClientRequest {
    /**
     * The `request.aborted` property will be `true` if the request has
     * been aborted.
     * @deprecated Since v17.0.0,v16.12.0 - Check `destroyed` instead.
     */
    aborted: boolean;
    /**
     * The request host.
     */
    host: string;
    /**
     * The request protocol.
     */
    protocol: string;
    /**
     * When sending request through a keep-alive enabled agent, the underlying socket
     * might be reused. But if server closes connection at unfortunate time, client
     * may run into a 'ECONNRESET' error.
     *
     * ```js
     * const http = require('http');
     *
     * // Server has a 5 seconds keep-alive timeout by default
     * http
     *   .createServer((req, res) => {
     *     res.write('hello\n');
     *     res.end();
     *   })
     *   .listen(3000);
     *
     * setInterval(() => {
     *   // Adapting a keep-alive agent
     *   http.get('http://localhost:3000', { agent }, (res) => {
     *     res.on('data', (data) => {
     *       // Do nothing
     *     });
     *   });
     * }, 5000); // Sending request on 5s interval so it's easy to hit idle timeout
     * ```
     *
     * By marking a request whether it reused socket or not, we can do
     * automatic error retry base on it.
     *
     * ```js
     * const http = require('http');
     * const agent = new http.Agent({ keepAlive: true });
     *
     * function retriableRequest() {
     *   const req = http
     *     .get('http://localhost:3000', { agent }, (res) => {
     *       // ...
     *     })
     *     .on('error', (err) => {
     *       // Check if retry is needed
     *       if (req.reusedSocket &#x26;&#x26; err.code === 'ECONNRESET') {
     *         retriableRequest();
     *       }
     *     });
     * }
     *
     * retriableRequest();
     * ```
     */
    reusedSocket: boolean;
    /**
     * Limits maximum response headers count. If set to 0, no limit will be applied.
     */
    maxHeadersCount: number;
    constructor(
      url: string | URL | ClientRequestArgs,
      cb?: (res: IncomingMessage) => void,
    );
    /**
     * The request method.
     */
    method: string;
    /**
     * The request path.
     */
    path: string;
    /**
     * Marks the request as aborting. Calling this will cause remaining data
     * in the response to be dropped and the socket to be destroyed.
     * @deprecated Since v14.1.0,v13.14.0 - Use `destroy` instead.
     */
    abort(): void;
    /**
     * Once a socket is assigned to this request and is connected `socket.setTimeout()` will be called.
     * @param timeout Milliseconds before a request times out.
     * @param callback Optional function to be called when a timeout occurs. Same as binding to the `'timeout'` event.
     */
    setTimeout(timeout: number, callback?: () => void): this;
    /**
     * Sets a single header value for the header object.
     * @param name Header name
     * @param value Header value
     */
    setHeader(
      name: string,
      value: number | string | ReadonlyArray<string>,
    ): this;
    /**
     * Gets the value of HTTP header with the given name. If such a name doesn't
     * exist in message, it will be `undefined`.
     * @param name Name of header
     */
    getHeader(name: string): number | string | string[] | undefined;
    /**
     * Removes a header that is queued for implicit sending.
     *
     * ```js
     * outgoingMessage.removeHeader('Content-Encoding');
     * ```
     * @param name Header name
     */
    removeHeader(name: string): void;
    /**
     * Compulsorily flushes the message headers
     *
     * For efficiency reason, Node.js normally buffers the message headers
     * until `outgoingMessage.end()` is called or the first chunk of message data
     * is written. It then tries to pack the headers and data into a single TCP
     * packet.
     *
     * It is usually desired (it saves a TCP round-trip), but not when the first
     * data is not sent until possibly much later. `outgoingMessage.flushHeaders()`bypasses the optimization and kickstarts the request.
     */
    flushHeaders(): void;
    /**
     * Once a socket is assigned to this request and is connected `socket.setNoDelay()` will be called.
     */
    setNoDelay(noDelay?: boolean): void;
    /**
     * Once a socket is assigned to this request and is connected `socket.setKeepAlive()` will be called.
     */
    setSocketKeepAlive(enable?: boolean, initialDelay?: number): void;
    /**
     * Returns an array containing the unique names of the current outgoing raw
     * headers. Header names are returned with their exact casing being set.
     *
     * ```js
     * request.setHeader('Foo', 'bar');
     * request.setHeader('Set-Cookie', ['foo=bar', 'bar=baz']);
     *
     * const headerNames = request.getRawHeaderNames();
     * // headerNames === ['Foo', 'Set-Cookie']
     * ```
     */
    getRawHeaderNames(): string[];
    /**
     * @deprecated
     */
    addListener(event: "abort", listener: () => void): this;
    addListener(event: "continue", listener: () => void): this;
    addListener(
      event: "information",
      listener: (info: InformationEvent) => void,
    ): this;
    addListener(
      event: "response",
      listener: (response: IncomingMessage) => void,
    ): this;
    addListener(event: "timeout", listener: () => void): this;
    addListener(event: "close", listener: () => void): this;
    addListener(event: "drain", listener: () => void): this;
    addListener(event: "error", listener: (err: Error) => void): this;
    addListener(event: "finish", listener: () => void): this;
    addListener(event: "pipe", listener: (src: stream.Readable) => void): this;
    addListener(
      event: "unpipe",
      listener: (src: stream.Readable) => void,
    ): this;
    addListener(
      event: string | symbol,
      listener: (...args: any[]) => void,
    ): this;
    /**
     * @deprecated
     */
    on(event: "abort", listener: () => void): this;
    on(event: "continue", listener: () => void): this;
    on(event: "information", listener: (info: InformationEvent) => void): this;
    on(event: "response", listener: (response: IncomingMessage) => void): this;
    on(event: "timeout", listener: () => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "drain", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "finish", listener: () => void): this;
    on(event: "pipe", listener: (src: stream.Readable) => void): this;
    on(event: "unpipe", listener: (src: stream.Readable) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    /**
     * @deprecated
     */
    once(event: "abort", listener: () => void): this;
    once(event: "continue", listener: () => void): this;
    once(
      event: "information",
      listener: (info: InformationEvent) => void,
    ): this;
    once(
      event: "response",
      listener: (response: IncomingMessage) => void,
    ): this;
    once(event: "timeout", listener: () => void): this;
    once(event: "close", listener: () => void): this;
    once(event: "drain", listener: () => void): this;
    once(event: "error", listener: (err: Error) => void): this;
    once(event: "finish", listener: () => void): this;
    once(event: "pipe", listener: (src: stream.Readable) => void): this;
    once(event: "unpipe", listener: (src: stream.Readable) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    /**
     * @deprecated
     */
    prependListener(event: "abort", listener: () => void): this;
    prependListener(event: "continue", listener: () => void): this;
    prependListener(
      event: "information",
      listener: (info: InformationEvent) => void,
    ): this;
    prependListener(
      event: "response",
      listener: (response: IncomingMessage) => void,
    ): this;
    prependListener(event: "timeout", listener: () => void): this;
    prependListener(event: "close", listener: () => void): this;
    prependListener(event: "drain", listener: () => void): this;
    prependListener(event: "error", listener: (err: Error) => void): this;
    prependListener(event: "finish", listener: () => void): this;
    prependListener(
      event: "pipe",
      listener: (src: stream.Readable) => void,
    ): this;
    prependListener(
      event: "unpipe",
      listener: (src: stream.Readable) => void,
    ): this;
    prependListener(
      event: string | symbol,
      listener: (...args: any[]) => void,
    ): this;
    /**
     * @deprecated
     */
    prependOnceListener(event: "abort", listener: () => void): this;
    prependOnceListener(event: "continue", listener: () => void): this;
    prependOnceListener(
      event: "information",
      listener: (info: InformationEvent) => void,
    ): this;
    prependOnceListener(
      event: "response",
      listener: (response: IncomingMessage) => void,
    ): this;
    prependOnceListener(event: "timeout", listener: () => void): this;
    prependOnceListener(event: "close", listener: () => void): this;
    prependOnceListener(event: "drain", listener: () => void): this;
    prependOnceListener(event: "error", listener: (err: Error) => void): this;
    prependOnceListener(event: "finish", listener: () => void): this;
    prependOnceListener(
      event: "pipe",
      listener: (src: stream.Readable) => void,
    ): this;
    prependOnceListener(
      event: "unpipe",
      listener: (src: stream.Readable) => void,
    ): this;
    prependOnceListener(
      event: string | symbol,
      listener: (...args: any[]) => void,
    ): this;
  }
  /**
   * An `IncomingMessage` object is created by {@link Server} or {@link ClientRequest} and passed as the first argument to the `'request'` and `'response'` event respectively. It may be used to
   * access response
   * status, headers and data.
   *
   * Different from its `socket` value which is a subclass of `stream.Duplex`, the`IncomingMessage` itself extends `stream.Readable` and is created separately to
   * parse and emit the incoming HTTP headers and payload, as the underlying socket
   * may be reused multiple times in case of keep-alive.
   */
  class IncomingMessage extends stream.Readable {
    /**
     * The `message.aborted` property will be `true` if the request has
     * been aborted.
     * @deprecated Since v17.0.0,v16.12.0 - Check `message.destroyed` from <a href="stream.html#class-streamreadable" class="type">stream.Readable</a>.
     */
    aborted: boolean;
    /**
     * In case of server request, the HTTP version sent by the client. In the case of
     * client response, the HTTP version of the connected-to server.
     * Probably either `'1.1'` or `'1.0'`.
     *
     * Also `message.httpVersionMajor` is the first integer and`message.httpVersionMinor` is the second.
     */
    httpVersion: string;
    httpVersionMajor: number;
    httpVersionMinor: number;
    /**
     * The `message.complete` property will be `true` if a complete HTTP message has
     * been received and successfully parsed.
     *
     * This property is particularly useful as a means of determining if a client or
     * server fully transmitted a message before a connection was terminated:
     *
     * ```js
     * const req = http.request({
     *   host: '127.0.0.1',
     *   port: 8080,
     *   method: 'POST'
     * }, (res) => {
     *   res.resume();
     *   res.on('end', () => {
     *     if (!res.complete)
     *       console.error(
     *         'The connection was terminated while the message was still being sent');
     *   });
     * });
     * ```
     */
    complete: boolean;
    /**
     * The request/response headers object.
     *
     * Key-value pairs of header names and values. Header names are lower-cased.
     *
     * ```js
     * // Prints something like:
     * //
     * // { 'user-agent': 'curl/7.22.0',
     * //   host: '127.0.0.1:8000',
     * //   accept: '*' }
     * console.log(request.getHeaders());
     * ```
     *
     * Duplicates in raw headers are handled in the following ways, depending on the
     * header name:
     *
     * * Duplicates of `age`, `authorization`, `content-length`, `content-type`,`etag`, `expires`, `from`, `host`, `if-modified-since`, `if-unmodified-since`,`last-modified`, `location`,
     * `max-forwards`, `proxy-authorization`, `referer`,`retry-after`, `server`, or `user-agent` are discarded.
     * * `set-cookie` is always an array. Duplicates are added to the array.
     * * For duplicate `cookie` headers, the values are joined together with '; '.
     * * For all other headers, the values are joined together with ', '.
     */
    headers: IncomingHttpHeaders;
    /**
     * The raw request/response headers list exactly as they were received.
     *
     * The keys and values are in the same list. It is _not_ a
     * list of tuples. So, the even-numbered offsets are key values, and the
     * odd-numbered offsets are the associated values.
     *
     * Header names are not lowercased, and duplicates are not merged.
     *
     * ```js
     * // Prints something like:
     * //
     * // [ 'user-agent',
     * //   'this is invalid because there can be only one',
     * //   'User-Agent',
     * //   'curl/7.22.0',
     * //   'Host',
     * //   '127.0.0.1:8000',
     * //   'ACCEPT',
     * //   '*' ]
     * console.log(request.rawHeaders);
     * ```
     */
    rawHeaders: string[];
    /**
     * The request/response trailers object. Only populated at the `'end'` event.
     */
    trailers: Dict<string>;
    /**
     * The raw request/response trailer keys and values exactly as they were
     * received. Only populated at the `'end'` event.
     */
    rawTrailers: string[];
    /**
     * Calls `message.socket.setTimeout(msecs, callback)`.
     */
    setTimeout(msecs: number, callback?: () => void): this;
    /**
     * **Only valid for request obtained from {@link Server}.**
     *
     * The request method as a string. Read only. Examples: `'GET'`, `'DELETE'`.
     */
    method?: string | undefined;
    /**
     * **Only valid for request obtained from {@link Server}.**
     *
     * Request URL string. This contains only the URL that is present in the actual
     * HTTP request. Take the following request:
     *
     * ```http
     * GET /status?name=ryan HTTP/1.1
     * Accept: text/plain
     * ```
     *
     * To parse the URL into its parts:
     *
     * ```js
     * new URL(request.url, `http://${request.getHeaders().host}`);
     * ```
     *
     * When `request.url` is `'/status?name=ryan'` and`request.getHeaders().host` is `'localhost:3000'`:
     *
     * ```console
     * $ node
     * > new URL(request.url, `http://${request.getHeaders().host}`)
     * URL {
     *   href: 'http://localhost:3000/status?name=ryan',
     *   origin: 'http://localhost:3000',
     *   protocol: 'http:',
     *   username: '',
     *   password: '',
     *   host: 'localhost:3000',
     *   hostname: 'localhost',
     *   port: '3000',
     *   pathname: '/status',
     *   search: '?name=ryan',
     *   searchParams: URLSearchParams { 'name' => 'ryan' },
     *   hash: ''
     * }
     * ```
     */
    url?: string | undefined;
    /**
     * **Only valid for response obtained from {@link ClientRequest}.**
     *
     * The 3-digit HTTP response status code. E.G. `404`.
     */
    statusCode?: number | undefined;
    /**
     * **Only valid for response obtained from {@link ClientRequest}.**
     *
     * The HTTP response status message (reason phrase). E.G. `OK` or `Internal Server Error`.
     */
    statusMessage?: string | undefined;
    /**
     * Calls `destroy()` on the socket that received the `IncomingMessage`. If `error`is provided, an `'error'` event is emitted on the socket and `error` is passed
     * as an argument to any listeners on the event.
     */
    destroy(error?: Error): this;
  }
  const METHODS: string[];
  const STATUS_CODES: {
    [errorCode: number]: string | undefined;
    [errorCode: string]: string | undefined;
  };
  // although RequestOptions are passed as ClientRequestArgs to ClientRequest directly,
  // create interface RequestOptions would make the naming more clear to developers
  interface RequestOptions extends ClientRequestArgs {}
  /**
   * `options` in `socket.connect()` are also supported.
   *
   * Node.js maintains several connections per server to make HTTP requests.
   * This function allows one to transparently issue requests.
   *
   * `url` can be a string or a `URL` object. If `url` is a
   * string, it is automatically parsed with `new URL()`. If it is a `URL` object, it will be automatically converted to an ordinary `options` object.
   *
   * If both `url` and `options` are specified, the objects are merged, with the`options` properties taking precedence.
   *
   * The optional `callback` parameter will be added as a one-time listener for
   * the `'response'` event.
   *
   * `http.request()` returns an instance of the {@link ClientRequest} class. The `ClientRequest` instance is a writable stream. If one needs to
   * upload a file with a POST request, then write to the `ClientRequest` object.
   *
   * ```js
   * const http = require('http');
   *
   * const postData = JSON.stringify({
   *   'msg': 'Hello World!'
   * });
   *
   * const options = {
   *   hostname: 'www.google.com',
   *   port: 80,
   *   path: '/upload',
   *   method: 'POST',
   *   headers: {
   *     'Content-Type': 'application/json',
   *     'Content-Length': Buffer.byteLength(postData)
   *   }
   * };
   *
   * const req = http.request(options, (res) => {
   *   console.log(`STATUS: ${res.statusCode}`);
   *   console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
   *   res.setEncoding('utf8');
   *   res.on('data', (chunk) => {
   *     console.log(`BODY: ${chunk}`);
   *   });
   *   res.on('end', () => {
   *     console.log('No more data in response.');
   *   });
   * });
   *
   * req.on('error', (e) => {
   *   console.error(`problem with request: ${e.message}`);
   * });
   *
   * // Write data to request body
   * req.write(postData);
   * req.end();
   * ```
   *
   * In the example `req.end()` was called. With `http.request()` one
   * must always call `req.end()` to signify the end of the request -
   * even if there is no data being written to the request body.
   *
   * If any error is encountered during the request (be that with DNS resolution,
   * TCP level errors, or actual HTTP parse errors) an `'error'` event is emitted
   * on the returned request object. As with all `'error'` events, if no listeners
   * are registered the error will be thrown.
   *
   * There are a few special headers that should be noted.
   *
   * * Sending a 'Connection: keep-alive' will notify Node.js that the connection to
   * the server should be persisted until the next request.
   * * Sending a 'Content-Length' header will disable the default chunked encoding.
   * * Sending an 'Expect' header will immediately send the request headers.
   * Usually, when sending 'Expect: 100-continue', both a timeout and a listener
   * for the `'continue'` event should be set. See RFC 2616 Section 8.2.3 for more
   * information.
   * * Sending an Authorization header will override using the `auth` option
   * to compute basic authentication.
   *
   * Example using a `URL` as `options`:
   *
   * ```js
   * const options = new URL('http://abc:xyz@example.com');
   *
   * const req = http.request(options, (res) => {
   *   // ...
   * });
   * ```
   *
   * In a successful request, the following events will be emitted in the following
   * order:
   *
   * * `'socket'`
   * * `'response'`
   *    * `'data'` any number of times, on the `res` object
   *    (`'data'` will not be emitted at all if the response body is empty, for
   *    instance, in most redirects)
   *    * `'end'` on the `res` object
   * * `'close'`
   *
   * In the case of a connection error, the following events will be emitted:
   *
   * * `'socket'`
   * * `'error'`
   * * `'close'`
   *
   * In the case of a premature connection close before the response is received,
   * the following events will be emitted in the following order:
   *
   * * `'socket'`
   * * `'error'` with an error with message `'Error: socket hang up'` and code`'ECONNRESET'`
   * * `'close'`
   *
   * In the case of a premature connection close after the response is received,
   * the following events will be emitted in the following order:
   *
   * * `'socket'`
   * * `'response'`
   *    * `'data'` any number of times, on the `res` object
   * * (connection closed here)
   * * `'aborted'` on the `res` object
   * * `'error'` on the `res` object with an error with message`'Error: aborted'` and code `'ECONNRESET'`.
   * * `'close'`
   * * `'close'` on the `res` object
   *
   * If `req.destroy()` is called before a socket is assigned, the following
   * events will be emitted in the following order:
   *
   * * (`req.destroy()` called here)
   * * `'error'` with an error with message `'Error: socket hang up'` and code`'ECONNRESET'`
   * * `'close'`
   *
   * If `req.destroy()` is called before the connection succeeds, the following
   * events will be emitted in the following order:
   *
   * * `'socket'`
   * * (`req.destroy()` called here)
   * * `'error'` with an error with message `'Error: socket hang up'` and code`'ECONNRESET'`
   * * `'close'`
   *
   * If `req.destroy()` is called after the response is received, the following
   * events will be emitted in the following order:
   *
   * * `'socket'`
   * * `'response'`
   *    * `'data'` any number of times, on the `res` object
   * * (`req.destroy()` called here)
   * * `'aborted'` on the `res` object
   * * `'error'` on the `res` object with an error with message`'Error: aborted'` and code `'ECONNRESET'`.
   * * `'close'`
   * * `'close'` on the `res` object
   *
   * If `req.abort()` is called before a socket is assigned, the following
   * events will be emitted in the following order:
   *
   * * (`req.abort()` called here)
   * * `'abort'`
   * * `'close'`
   *
   * If `req.abort()` is called before the connection succeeds, the following
   * events will be emitted in the following order:
   *
   * * `'socket'`
   * * (`req.abort()` called here)
   * * `'abort'`
   * * `'error'` with an error with message `'Error: socket hang up'` and code`'ECONNRESET'`
   * * `'close'`
   *
   * If `req.abort()` is called after the response is received, the following
   * events will be emitted in the following order:
   *
   * * `'socket'`
   * * `'response'`
   *    * `'data'` any number of times, on the `res` object
   * * (`req.abort()` called here)
   * * `'abort'`
   * * `'aborted'` on the `res` object
   * * `'error'` on the `res` object with an error with message`'Error: aborted'` and code `'ECONNRESET'`.
   * * `'close'`
   * * `'close'` on the `res` object
   *
   * Setting the `timeout` option or using the `setTimeout()` function will
   * not abort the request or do anything besides add a `'timeout'` event.
   *
   * Passing an `AbortSignal` and then calling `abort` on the corresponding`AbortController` will behave the same way as calling `.destroy()` on the
   * request itself.
   */
  function request(
    options: RequestOptions | string | URL,
    callback?: (res: IncomingMessage) => void,
  ): ClientRequest;
  function request(
    url: string | URL,
    options: RequestOptions,
    callback?: (res: IncomingMessage) => void,
  ): ClientRequest;
  /**
   * Since most requests are GET requests without bodies, Node.js provides this
   * convenience method. The only difference between this method and {@link request} is that it sets the method to GET and calls `req.end()`automatically. The callback must take care to consume the
   * response
   * data for reasons stated in {@link ClientRequest} section.
   *
   * The `callback` is invoked with a single argument that is an instance of {@link IncomingMessage}.
   *
   * JSON fetching example:
   *
   * ```js
   * http.get('http://localhost:8000/', (res) => {
   *   const { statusCode } = res;
   *   const contentType = res.headers['content-type'];
   *
   *   let error;
   *   // Any 2xx status code signals a successful response but
   *   // here we're only checking for 200.
   *   if (statusCode !== 200) {
   *     error = new Error('Request Failed.\n' +
   *                       `Status Code: ${statusCode}`);
   *   } else if (!/^application\/json/.test(contentType)) {
   *     error = new Error('Invalid content-type.\n' +
   *                       `Expected application/json but received ${contentType}`);
   *   }
   *   if (error) {
   *     console.error(error.message);
   *     // Consume response data to free up memory
   *     res.resume();
   *     return;
   *   }
   *
   *   res.setEncoding('utf8');
   *   let rawData = '';
   *   res.on('data', (chunk) => { rawData += chunk; });
   *   res.on('end', () => {
   *     try {
   *       const parsedData = JSON.parse(rawData);
   *       console.log(parsedData);
   *     } catch (e) {
   *       console.error(e.message);
   *     }
   *   });
   * }).on('error', (e) => {
   *   console.error(`Got error: ${e.message}`);
   * });
   *
   * // Create a local server to receive data from
   * const server = http.createServer((req, res) => {
   *   res.writeHead(200, { 'Content-Type': 'application/json' });
   *   res.end(JSON.stringify({
   *     data: 'Hello World!'
   *   }));
   * });
   *
   * server.listen(8000);
   * ```
   * @param options Accepts the same `options` as {@link request}, with the `method` always set to `GET`. Properties that are inherited from the prototype are ignored.
   */
  function get(
    options: RequestOptions | string | URL,
    callback?: (res: IncomingMessage) => void,
  ): ClientRequest;
  function get(
    url: string | URL,
    options: RequestOptions,
    callback?: (res: IncomingMessage) => void,
  ): ClientRequest;
  /**
   * Read-only property specifying the maximum allowed size of HTTP headers in bytes.
   * Defaults to 16KB. Configurable using the `--max-http-header-size` CLI option.
   */
  const maxHeaderSize: number;
}
declare module "node:http" {
  export * from "http";
}
// XXX: temporary types till theres a proper http(s) module
declare module "https" {
  export * from "http";
}
declare module "node:https" {
  export * from "http";
}
