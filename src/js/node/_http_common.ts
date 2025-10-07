const { checkIsHttpToken } = require("internal/validators");
const FreeList = require("internal/freelist");
const { methods, allMethods, HTTPParser } = process.binding("http_parser");
const incoming = require("node:_http_incoming");

const { IncomingMessage, readStart, readStop } = incoming;

const RegExpPrototypeExec = RegExp.prototype.exec;

let headerCharRegex;

/**
 * True if val contains an invalid field-vchar
 *  field-value    = *( field-content / obs-fold )
 *  field-content  = field-vchar [ 1*( SP / HTAB ) field-vchar ]
 *  field-vchar    = VCHAR / obs-text
 */
function checkInvalidHeaderChar(val: string) {
  if (!headerCharRegex) {
    headerCharRegex = /[^\t\x20-\x7e\x80-\xff]/;
  }
  return RegExpPrototypeExec.$call(headerCharRegex, val) !== null;
}

const validateHeaderName = (name, label?) => {
  if (typeof name !== "string" || !name || !checkIsHttpToken(name)) {
    throw $ERR_INVALID_HTTP_TOKEN(label || "Header name", name);
  }
};

const validateHeaderValue = (name, value) => {
  if (value === undefined) {
    throw $ERR_HTTP_INVALID_HEADER_VALUE(value, name);
  }
  if (checkInvalidHeaderChar(value)) {
    throw $ERR_INVALID_CHAR("header content", name);
  }
};

// TODO: TODO!
// const insecureHTTPParser = getOptionValue('--insecure-http-parser');
const insecureHTTPParser = false;

const kIncomingMessage = Symbol("IncomingMessage");
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
function parserOnHeaders(headers, url) {
  // Once we exceeded headers limit - stop collecting them
  if (this.maxHeaderPairs <= 0 || this._headers.length < this.maxHeaderPairs) {
    this._headers.push(...headers);
  }
  this._url += url;
}

// `headers` and `url` are set only if .onHeaders() has not been called for
// this request.
// `url` is not set for response parsers but that's not applicable here since
// all our parsers are request parsers.
function parserOnHeadersComplete(
  versionMajor,
  versionMinor,
  headers,
  method,
  url,
  statusCode,
  statusMessage,
  upgrade,
  shouldKeepAlive,
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

  const incoming = (parser.incoming = new ParserIncomingMessage(socket));
  incoming.httpVersionMajor = versionMajor;
  incoming.httpVersionMinor = versionMinor;
  incoming.httpVersion = `${versionMajor}.${versionMinor}`;
  incoming.joinDuplicateHeaders = socket?.server?.joinDuplicateHeaders || parser.joinDuplicateHeaders;
  incoming.url = url;
  incoming.upgrade = upgrade;

  let n = headers.length;

  // If parser.maxHeaderPairs <= 0 assume that there's no limit.
  if (parser.maxHeaderPairs > 0) n = Math.min(n, parser.maxHeaderPairs);

  incoming._addHeaderLines(headers, n);

  if (typeof method === "number") {
    // server only
    incoming.method = allMethods[method];
  } else {
    // client only
    incoming.statusCode = statusCode;
    incoming.statusMessage = statusMessage;
  }

  return parser.onIncoming(incoming, shouldKeepAlive);
}

function parserOnBody(b) {
  const stream = this.incoming;

  // If the stream has already been removed, then drop it.
  if (stream === null) return;

  // Pretend this was the result of a stream._read call.
  if (!stream._dumped) {
    const ret = stream.push(b);
    if (!ret) readStop(this.socket);
  }
}

function parserOnMessageComplete() {
  const parser = this;
  const stream = parser.incoming;

  if (stream !== null) {
    stream.complete = true;
    // Emit any trailing headers.
    const headers = parser._headers;
    if (headers.length) {
      stream._addHeaderLines(headers, headers.length);
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

function closeParserInstance(parser) {
  parser.close();
}

// Free the parser and also break any links that it
// might have to any other things.
// TODO: All parser data should be attached to a
// single object, so that it can be easily cleaned
// up by doing `parser.data = {}`, which should
// be done in FreeList.free.  `parsers.free(parser)`
// should be all that is needed.
function freeParser(parser, req, socket) {
  if (parser) {
    if (parser._consumed) parser.unconsume();
    cleanParser(parser);
    parser.remove();
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

function cleanParser(parser) {
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

function prepareError(err, parser, rawPacket) {
  err.rawPacket = rawPacket || parser.getCurrentBuffer();
  if (typeof err.reason === "string") err.message = `Parse Error: ${err.reason}`;
}

let warnedLenient = false;

function isLenient() {
  if (insecureHTTPParser && !warnedLenient) {
    warnedLenient = true;
    process.emitWarning("Using insecure HTTP parsing");
  }
  return insecureHTTPParser;
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
  HTTPParser,
  isLenient,
  prepareError,
};
