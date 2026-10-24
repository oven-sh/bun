// This is a port of Node.js's lib/_http_common.js
// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_common.js
const { checkIsHttpToken } = require("internal/validators");
const FreeList = require("internal/freelist");
const http = require("internal/http");
// A symbol taken out of a pattern is a plain `symbol` for the type checker, and what it keys is untyped.
const kIncomingMessage: typeof http.kIncomingMessage = http.kIncomingMessage;
const kSkipPendingData: typeof http.kSkipPendingData = http.kSkipPendingData;
const kHeaderSource: typeof http.kHeaderSource = http.kHeaderSource;

interface HTTPParserConstructor {
  new (): $Node.HTTPParser;
  readonly prototype: any;
  readonly REQUEST: number;
  readonly RESPONSE: number;
  readonly kOnMessageBegin: number;
  readonly kOnHeaders: number;
  readonly kOnHeadersComplete: number;
  readonly kOnBody: number;
  readonly kOnMessageComplete: number;
  readonly kOnExecute: number;
  readonly kOnTimeout: number;
  readonly kLenientNone: number;
  readonly kLenientHeaders: number;
  readonly kLenientChunkedLength: number;
  readonly kLenientKeepAlive: number;
  readonly kLenientTransferEncoding: number;
  readonly kLenientVersion: number;
  readonly kLenientDataAfterClose: number;
  readonly kLenientOptionalLFAfterCR: number;
  readonly kLenientOptionalCRLFAfterChunk: number;
  readonly kLenientOptionalCRBeforeLF: number;
  readonly kLenientSpacesAfterChunkSize: number;
  readonly kLenientHeaderValueRelaxed: number;
  readonly kLenientAll: number;
}

interface HTTPParserBinding {
  methods: readonly string[];
  allMethods: readonly string[];
  HTTPParser: HTTPParserConstructor;
  ConnectionsList: unknown;
}

const { methods, allMethods, HTTPParser } = process.binding("http_parser") as HTTPParserBinding;
const incoming = require("node:_http_incoming");

const { IncomingMessage, readStart, readStop } = incoming;

const RegExpPrototypeExec = RegExp.prototype.exec as (this: RegExp, text: unknown) => RegExpExecArray | null;

let strictHeaderCharRegex: RegExp | undefined;
let lenientHeaderCharRegex: RegExp | undefined;

/**
 * True if val contains an invalid header value character.
 * By default uses strict validation per RFC 7230:
 *  field-value    = *( field-content / obs-fold )
 *  field-content  = field-vchar [ 1*( SP / HTAB ) field-vchar ]
 *  field-vchar    = VCHAR / obs-text
 * When lenient=true, uses relaxed validation per the Fetch spec
 * (https://fetch.spec.whatwg.org/#header-value): only NUL, CR, LF and
 * characters above 0xff are rejected.
 */
function checkInvalidHeaderChar(val: $Node.HttpHeaderValue | Buffer, lenient: boolean = false) {
  // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
  if (typeof val === "string" && val.length <= 32) {
    const length = val.length;
    if (lenient) {
      for (let i = 0; i < length; i++) {
        const code = val.charCodeAt(i);
        if (code === 0x00 || code === 0x0a || code === 0x0d || code > 0xff) return true;
      }
    } else {
      for (let i = 0; i < length; i++) {
        const code = val.charCodeAt(i);
        if (code < 0x20 ? code !== 0x09 : code === 0x7f || code > 0xff) return true;
      }
    }
    return false;
  }
  if (lenient) {
    // eslint-disable-next-line no-control-regex
    lenientHeaderCharRegex ??= /[\x00\x0a\x0d]|[^\x00-\xff]/;
    return RegExpPrototypeExec.$call(lenientHeaderCharRegex, val) !== null;
  }
  strictHeaderCharRegex ??= /[^\t\x20-\x7e\x80-\xff]/;
  // Nearly always a string. `exec` converts what is none.
  return RegExpPrototypeExec.$call(strictHeaderCharRegex, val) !== null;
}

const validateHeaderName = (name: string, label?: string) => {
  if (typeof name !== "string" || !name || !checkIsHttpToken(name)) {
    throw $ERR_INVALID_HTTP_TOKEN(label || "Header name", name);
  }
};

const validateHeaderValue = (name: string, value: $Node.HttpHeaderValue) => {
  if (value === undefined) {
    throw $ERR_HTTP_INVALID_HEADER_VALUE(value, name);
  }
  if (checkInvalidHeaderChar(value)) {
    throw $ERR_INVALID_CHAR("header content", name);
  }
};

// Node's `getOptionValue('--insecure-http-parser')`. The flag is fixed during
// CLI parsing, so reading it once here is equivalent.
const insecureHTTPParser = $bindgen("node_http_binding.bind.ts", "insecureHTTPParser") as boolean;

const kOnMessageBegin = HTTPParser.kOnMessageBegin | 0;
const kOnHeaders = HTTPParser.kOnHeaders | 0;
const kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0;
const kOnBody = HTTPParser.kOnBody | 0;
const kOnMessageComplete = HTTPParser.kOnMessageComplete | 0;
const kOnExecute = HTTPParser.kOnExecute | 0;
const kOnTimeout = HTTPParser.kOnTimeout | 0;

const MAX_HEADER_PAIRS = 2000;

// Only called in the slow case where slow means
// that the request headers were either fragmented
// across multiple TCP packets or too large to be
// processed in a single run. This method is also
// called to process trailing HTTP headers.
function parserOnHeaders(this: $Node.HTTPParser, headers: string[], url: string) {
  // Once we exceeded headers limit - stop collecting them
  const capacity = this.maxHeaderPairs - this._headers.length;
  if (this.maxHeaderPairs <= 0 || capacity >= headers.length) {
    this._headers.push(...headers);
  } else if (capacity > 0) {
    this._headers.push(...headers.slice(0, capacity));
  }
  this._url += url;
}

// `headers` and `url` are set only if .onHeaders() has not been called for
// this request.
// `url` is not set for response parsers but that's not applicable here since
// all our parsers are request parsers.
function parserOnHeadersComplete(
  this: $Node.HTTPParser,
  versionMajor: number,
  versionMinor: number,
  headers: string[] | undefined,
  method: number | undefined,
  url: string | undefined,
  statusCode: number | undefined,
  statusMessage: string | undefined,
  upgrade: boolean,
  shouldKeepAlive: boolean,
) {
  const parser = this;
  const { socket } = parser;

  if (headers === undefined) {
    headers = parser._headers;
    parser._headers = [];
  }

  if (url === undefined) {
    url = parser._url;
    parser._url = "";
  }

  // Parser is also used by http client
  const ParserIncomingMessage = socket?.server?.[kIncomingMessage] || IncomingMessage;

  const incoming: $Node.IncomingMessage = (parser.incoming = new ParserIncomingMessage(socket));
  incoming[kHeaderSource] = null;
  incoming.httpVersionMajor = versionMajor;
  incoming.httpVersionMinor = versionMinor;
  incoming.httpVersion = `${versionMajor}.${versionMinor}`;
  incoming.joinDuplicateHeaders = socket?.server?.joinDuplicateHeaders || parser.joinDuplicateHeaders;
  incoming.url = url;
  incoming.upgrade = upgrade;

  let n = headers.length;

  // If parser.maxHeaderPairs <= 0 assume that there's no limit.
  const maxHeaderPairs = parser.maxHeaderPairs;
  if (maxHeaderPairs > 0) n = Math.min(n, maxHeaderPairs);

  incoming._addHeaderLines(headers, n);

  if (typeof method === "number") {
    // server only
    incoming.method = allMethods[method];
  } else {
    // client only
    incoming.statusCode = statusCode!;
    incoming.statusMessage = statusMessage!;
  }

  return parser.onIncoming!(incoming, shouldKeepAlive);
}

function parserOnBody(this: $Node.HTTPParser, b: Buffer) {
  const stream = this.incoming;

  // If the stream has already been removed, then drop it.
  if (stream === null || stream[kSkipPendingData]) return;

  // Pretend this was the result of a stream._read call.
  if (!stream._dumped) {
    const ret = stream.push(b);
    if (!ret) readStop(this.socket);
  }
}

function parserOnMessageComplete(this: $Node.HTTPParser) {
  const parser = this;
  const stream = parser.incoming;

  if (stream !== null && !stream[kSkipPendingData]) {
    stream.complete = true;
    // Emit any trailing headers.
    const headers = parser._headers;
    const headersLength = headers.length;
    if (headersLength) {
      stream._addHeaderLines(headers, headersLength);
      parser._headers = [];
      parser._url = "";
    }

    // For emit end event
    stream.push(null);
  }

  // Force to read the next incoming message
  readStart(parser.socket);
}

const parsers = new FreeList("parsers", 1000, function parsersCb() {
  const parser = new HTTPParser();

  cleanParser(parser);

  parser[kOnHeaders] = parserOnHeaders;
  parser[kOnHeadersComplete] = parserOnHeadersComplete;
  parser[kOnBody] = parserOnBody;
  parser[kOnMessageComplete] = parserOnMessageComplete;

  return parser;
});

function closeParserInstance(parser: $Node.HTTPParser) {
  parser.close();
}

// Free the parser and also break any links that it
// might have to any other things.
// TODO: All parser data should be attached to a
// single object, so that it can be easily cleaned
// up by doing `parser.data = {}`, which should
// be done in FreeList.free.  `parsers.free(parser)`
// should be all that is needed.
function freeParser(
  parser: $Node.HTTPParser | null | undefined,
  req: $Node.ClientRequest | $Node.IncomingMessage | null | undefined,
  socket: $Node.HttpSocket | null | undefined,
) {
  if (parser) {
    if (parser._consumed) parser.unconsume();
    parser.remove();
    cleanParser(parser);
    if (parsers.free(parser) === false) {
      // Make sure the parser's stack has unwound before deleting the
      // corresponding C++ object through .close().
      setImmediate(closeParserInstance, parser);
    } else {
      // Since the Parser destructor isn't going to run the destroy() callbacks
      // it needs to be triggered manually.
      parser.free();
    }
  }
  if (req) {
    req.parser = null;
  }
  if (socket) {
    socket.parser = null;
  }
}

function cleanParser(parser: $Node.HTTPParser) {
  parser._headers = [];
  parser._url = "";
  parser.socket = null;
  parser.incoming = null;
  parser.outgoing = null;
  parser.maxHeaderPairs = MAX_HEADER_PAIRS;
  parser[kOnMessageBegin] = null;
  parser[kOnExecute] = null;
  parser[kOnTimeout] = null;
  parser._consumed = false;
  parser.onIncoming = null;
  parser.joinDuplicateHeaders = null;
}

function prepareError(
  err: Error & { rawPacket?: Buffer | Uint8Array; reason?: string },
  parser: $Node.HTTPParser,
  rawPacket: Buffer | Uint8Array | null | undefined,
) {
  err.rawPacket = rawPacket || parser.getCurrentBuffer();
  const reason = err.reason;
  if (typeof reason === "string") err.message = `Parse Error: ${reason}`;
}

let warnedLenient = false;

function isLenient() {
  if (insecureHTTPParser && !warnedLenient) {
    warnedLenient = true;
    process.emitWarning("Using insecure HTTP parsing");
  }
  return insecureHTTPParser;
}

const kLenientNone = HTTPParser.kLenientNone | 0;
const kLenientAll = HTTPParser.kLenientAll | 0;
const kLenientHeaderValueRelaxed = HTTPParser.kLenientHeaderValueRelaxed | 0;

function calculateLenientFlags(
  httpValidation: "strict" | "relaxed" | "insecure" | undefined,
  insecureHTTPParserOption: boolean | undefined,
) {
  if (httpValidation === "strict") {
    return kLenientNone;
  } else if (httpValidation === "relaxed") {
    return kLenientHeaderValueRelaxed;
  } else if (httpValidation === "insecure") {
    return kLenientAll;
  }
  const lenient = insecureHTTPParserOption === undefined ? isLenient() : insecureHTTPParserOption;
  return lenient ? kLenientAll : kLenientNone;
}

export default {
  validateHeaderName,
  validateHeaderValue,
  _checkIsHttpToken: checkIsHttpToken,
  _checkInvalidHeaderChar: checkInvalidHeaderChar,
  chunkExpression: /(?:^|\W)chunked(?:$|\W)/i,
  continueExpression: /(?:^|\W)100-continue(?:$|\W)/i,
  CRLF: "\r\n",
  freeParser,
  methods,
  parsers,
  kIncomingMessage,
  kSkipPendingData,
  HTTPParser,
  isLenient,
  calculateLenientFlags,
  prepareError,
  MAX_HEADER_PAIRS,
} as const;
