const { checkIsHttpToken } = require("internal/validators");

const kIncomingMessage = Symbol("IncomingMessage");

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

const methods = [
  "DELETE",
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "CONNECT",
  "OPTIONS",
  "TRACE",
  "COPY",
  "LOCK",
  "MKCOL",
  "MOVE",
  "PROPFIND",
  "PROPPATCH",
  "SEARCH",
  "UNLOCK",
  "BIND",
  "REBIND",
  "UNBIND",
  "ACL",
  "REPORT",
  "MKACTIVITY",
  "CHECKOUT",
  "MERGE",
  "M-SEARCH",
  "NOTIFY",
  "SUBSCRIBE",
  "UNSUBSCRIBE",
  "PATCH",
  "PURGE",
  "MKCALENDAR",
  "LINK",
  "UNLINK",
  "SOURCE",
  "QUERY",
];

export default {
  _checkIsHttpToken: checkIsHttpToken,
  _checkInvalidHeaderChar: checkInvalidHeaderChar,
  chunkExpression: /(?:^|\W)chunked(?:$|\W)/i,
  continueExpression: /(?:^|\W)100-continue(?:$|\W)/i,
  CRLF: "\r\n",
  methods,
  kIncomingMessage,
  validateHeaderName,
  validateHeaderValue,
};
