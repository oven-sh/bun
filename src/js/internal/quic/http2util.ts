// Header-list helpers used by the QUIC (HTTP/3) implementation.
// Ported from the relevant pieces of Node.js lib/internal/http2/util.js
// (v26.3.0): kValidPseudoHeaders, kSingleValueFields,
// isIllegalConnectionSpecificHeader, assertValidPseudoHeader and
// buildNgHeaderString. The serialized header-string format
// (`name\0value\0flag` triplets, pseudo-headers first) is consumed by the
// native quic binding's sendHeaders()/openStream() implementations.

const ObjectKeys = Object.keys;
const ArrayIsArray = Array.isArray;

// Matches Node's sensitiveHeaders marker used by node:http2.
const kSensitiveHeaders = Symbol.for("nodejs.http2.sensitiveHeaders");

// Verbatim from Node lib/internal/http.js (checkIsHttpToken).
const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
function checkIsHttpToken(val) {
  return tokenRegExp.test(val);
}

// This set is defined strictly by the HTTP/2 specification. Only
// :-prefixed headers defined by that specification may be added to
// this set.
const kValidPseudoHeaders = new Set([":status", ":method", ":authority", ":scheme", ":path", ":protocol"]);

// This set contains headers that are permitted to have only a single
// value. Multiple instances must not be specified.
const kSingleValueFields = new Set([
  ":status",
  ":method",
  ":authority",
  ":scheme",
  ":path",
  ":protocol",
  "access-control-allow-credentials",
  "access-control-max-age",
  "access-control-request-method",
  "age",
  "authorization",
  "content-encoding",
  "content-language",
  "content-length",
  "content-location",
  "content-md5",
  "content-range",
  "content-type",
  "date",
  "dnt",
  "etag",
  "expires",
  "from",
  "host",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "last-modified",
  "location",
  "max-forwards",
  "proxy-authorization",
  "range",
  "referer",
  "retry-after",
  "tk",
  "upgrade-insecure-requests",
  "user-agent",
  "x-content-type-options",
]);

function isIllegalConnectionSpecificHeader(name, value) {
  switch (name) {
    case "connection":
    case "upgrade":
    case "http2-settings":
    case "keep-alive":
    case "proxy-connection":
    case "transfer-encoding":
      return true;
    case "te":
      return value !== "trailers";
    default:
      return false;
  }
}

function assertValidPseudoHeader(key) {
  if (!kValidPseudoHeaders.has(key)) {
    throw $ERR_HTTP2_INVALID_PSEUDOHEADER(key);
  }
}

const emptyArray = [];
// NGHTTP2_NV_FLAG_NO_INDEX / NGHTTP2_NV_FLAG_NONE encoded as single chars.
const kNeverIndexFlag = String.fromCharCode(1);
const kNoHeaderFlags = String.fromCharCode(0);

// The serialized header list is NUL-delimited (`name\0value\0flags`), so an
// embedded NUL in a header value would desync the triplets parsed by the
// native side. RFC 9114 forbids NUL in field values regardless (RFC 9114 §4.2).
function assertNoNulInValue(key, value) {
  if (value.indexOf("\0") !== -1) {
    throw $ERR_INVALID_CHAR("header content", key);
  }
}

/**
 * Builds an NgHeader string + header count value, validating the header key
 * format, rejecting illegal header configurations, and marking sensitive headers
 * that should not be indexed en route. This takes either a flat map of
 * raw headers ([k1, v1, k2, v2]) or a header object ({ k1: v1, k2: [v2, v3] }).
 *
 * Takes a validation function to check the pseudo-headers allowed for this
 * message, and a boolean indicating whether to enforce strict single-value
 * header validation.
 * @returns {[string, number]}
 */
function buildNgHeaderString(arrayOrMap, validatePseudoHeaderValue, strictSingleValueFields) {
  let headers = "";
  let pseudoHeaders = "";
  let count = 0;

  const singles = new Set();
  const sensitiveHeaders = arrayOrMap[kSensitiveHeaders] || emptyArray;
  const neverIndex = sensitiveHeaders.map(v => v.toLowerCase());

  function processHeader(key, value) {
    key = key.toLowerCase();
    const isStrictSingleValueField = strictSingleValueFields && kSingleValueFields.has(key);
    let isArray = ArrayIsArray(value);
    if (isArray) {
      switch (value.length) {
        case 0:
          return;
        case 1:
          value = String(value[0]);
          isArray = false;
          break;
        default:
          if (isStrictSingleValueField)
            throw $ERR_HTTP2_HEADER_SINGLE_VALUE(`Header field "${key}" must only have a single value`);
      }
    } else {
      value = String(value);
    }
    if (!isArray) assertNoNulInValue(key, value);
    if (isStrictSingleValueField) {
      if (singles.has(key)) throw $ERR_HTTP2_HEADER_SINGLE_VALUE(`Header field "${key}" must only have a single value`);
      singles.add(key);
    }
    const flags = neverIndex.includes(key) ? kNeverIndexFlag : kNoHeaderFlags;
    if (key[0] === ":") {
      const err = validatePseudoHeaderValue(key);
      if (err !== undefined) throw err;
      if (isArray) assertNoNulInValue(key, `${value}`);
      pseudoHeaders += `${key}\0${value}\0${flags}`;
      count++;
      return;
    }
    if (!checkIsHttpToken(key)) {
      throw $ERR_INVALID_HTTP_TOKEN("Header name", key);
    }
    if (isIllegalConnectionSpecificHeader(key, value)) {
      throw $ERR_HTTP2_INVALID_CONNECTION_HEADERS(`HTTP/1 Connection specific headers are forbidden: "${key}"`);
    }
    if (isArray) {
      for (let j = 0; j < value.length; ++j) {
        const val = String(value[j]);
        assertNoNulInValue(key, val);
        headers += `${key}\0${val}\0${flags}`;
      }
      count += value.length;
      return;
    }
    headers += `${key}\0${value}\0${flags}`;
    count++;
  }

  if (ArrayIsArray(arrayOrMap)) {
    for (let i = 0; i < arrayOrMap.length; i += 2) {
      const key = arrayOrMap[i];
      const value = arrayOrMap[i + 1];
      if (value === undefined || key === "") continue;
      processHeader(key, value);
    }
  } else {
    const keys = ObjectKeys(arrayOrMap);
    for (let i = 0; i < keys.length; ++i) {
      const key = keys[i];
      const value = arrayOrMap[key];
      if (value === undefined || key === "") continue;
      processHeader(key, value);
    }
  }

  return [pseudoHeaders + headers, count];
}

export default {
  assertValidPseudoHeader,
  buildNgHeaderString,
};
