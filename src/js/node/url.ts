/// <reference path="../builtins.d.ts" />

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";

const { Array, Int8Array, SafeSet, uncurryThis } = require("internal/primordials");

const ObjectKeys = Object.keys;
const ObjectAssign = Object.assign;
const NumberPrototypeToString = uncurryThis(Number.prototype.toString);
const StringPrototypeCharCodeAt = uncurryThis(String.prototype.charCodeAt);
const StringPrototypeSlice = uncurryThis(String.prototype.slice);
const StringPrototypeToUpperCase = uncurryThis(String.prototype.toUpperCase);

let lazyQuerystring: typeof import("node:querystring") | undefined;
function querystring() {
  return (lazyQuerystring ||= require("node:querystring"));
}

const [domainToASCII, domainToUnicode] = $cpp("NodeURL.cpp", "Bun::createNodeURLBinding");
const { urlToHttpOptions } = require("internal/url");
const { validateString, validateObject } = require("internal/validators");

// Protocols that can allow "unsafe" and "unwise" chars.
// prettier-ignore
const unsafeProtocol = new SafeSet([
  "javascript",
  "javascript:",
]);

// Protocols that never have a hostname.
// prettier-ignore
const hostlessProtocol = unsafeProtocol;

// Protocols that always contain a // bit.
// prettier-ignore
const slashedProtocol = new SafeSet([
  "http",
  "http:",
  "https",
  "https:",
  "ftp",
  "ftp:",
  "gopher",
  "gopher:",
  "file",
  "file:",
  "ws",
  "ws:",
  "wss",
  "wss:",
]);

// Original url.parse() API
type Url = import("node:url").Url;
type UrlObject = Url | URL;
type UrlLike = string | UrlObject;

function Url() {
  this.protocol = null;
  this.slashes = null;
  this.auth = null;
  this.host = null;
  this.port = null;
  this.hostname = null;
  this.hash = null;
  this.search = null;
  this.query = null;
  this.pathname = null;
  this.path = null;
  this.href = null;
}

Url.prototype = {};

// Reference: RFC 3986, RFC 1808, RFC 2396

// define these here so at least they only have to be
// compiled once on the first module load.
const protocolPattern = /^[a-z0-9.+-]+:/i;
const portPattern = /:[0-9]*$/;
const hostPattern = /^\/\/[^@/]+@[^@/]+/;

// Special case for a simple path URL
const simplePathPattern = /^(\/\/?(?!\/)[^?\s]*)(\?[^\s]*)?$/;

const hostnameMaxLen = 255;

/**
 * Add new characters as needed from
 * [here](https://github.com/nodejs/node/blob/main/lib/internal/constants.js).
 *
 * @note Do not move to another file, otherwise const enums will be imported as an object
 *      instead of being inlined.
 */
// prettier-ignore
const enum Char {
  // Alphabet chars.
  CHAR_UPPERCASE_A = 65, /* A */
  CHAR_LOWERCASE_A = 97, /* a */
  CHAR_UPPERCASE_Z = 90, /* Z */
  CHAR_LOWERCASE_Z = 122, /* z */
  CHAR_UPPERCASE_C = 67, /* C */
  CHAR_LOWERCASE_B = 98, /* b */
  CHAR_LOWERCASE_E = 101, /* e */
  CHAR_LOWERCASE_N = 110, /* n */

  // Non-alphabetic chars.
  CHAR_DOT = 46, /* . */
  CHAR_FORWARD_SLASH = 47, /* / */
  CHAR_BACKWARD_SLASH = 92, /* \ */
  CHAR_VERTICAL_LINE = 124, /* | */
  CHAR_COLON = 58, /* : */
  CHAR_QUESTION_MARK = 63, /* ? */
  CHAR_UNDERSCORE = 95, /* _ */
  CHAR_LINE_FEED = 10, /* \n */
  CHAR_CARRIAGE_RETURN = 13, /* \r */
  CHAR_TAB = 9, /* \t */
  CHAR_FORM_FEED = 12, /* \f */
  CHAR_EXCLAMATION_MARK = 33, /* ! */
  CHAR_HASH = 35, /* # */
  CHAR_SPACE = 32, /*   */
  CHAR_NO_BREAK_SPACE = 160, /* \u00A0 */
  CHAR_ZERO_WIDTH_NOBREAK_SPACE = 65279, /* \uFEFF */
  CHAR_LEFT_SQUARE_BRACKET = 91, /* [ */
  CHAR_RIGHT_SQUARE_BRACKET = 93, /* ] */
  CHAR_LEFT_ANGLE_BRACKET = 60, /* < */
  CHAR_RIGHT_ANGLE_BRACKET = 62, /* > */
  CHAR_LEFT_CURLY_BRACKET = 123, /* { */
  CHAR_RIGHT_CURLY_BRACKET = 125, /* } */
  CHAR_HYPHEN_MINUS = 45, /* - */
  CHAR_PLUS = 43, /* + */
  CHAR_DOUBLE_QUOTE = 34, /* " */
  CHAR_SINGLE_QUOTE = 39, /* ' */
  CHAR_PERCENT = 37, /* % */
  CHAR_SEMICOLON = 59, /* ; */
  CHAR_CIRCUMFLEX_ACCENT = 94, /* ^ */
  CHAR_GRAVE_ACCENT = 96, /* ` */
  CHAR_AT = 64, /* @ */
  CHAR_AMPERSAND = 38, /* & */
  CHAR_EQUAL = 61, /* = */

  // Digits
  CHAR_0 = 48, /* 0 */
  CHAR_9 = 57, /* 9 */
}

function urlParse(url: UrlLike, parseQueryString?: boolean, slashesDenoteHost?: boolean): Url {
  if (url instanceof Url) return url;

  const urlObject = new Url();
  urlObject.parse(url, parseQueryString, slashesDenoteHost);
  return urlObject;
}

function isIpv6Hostname(hostname: string): boolean {
  return (
    StringPrototypeCharCodeAt(hostname, 0) === Char.CHAR_LEFT_SQUARE_BRACKET &&
    StringPrototypeCharCodeAt(hostname, hostname.length - 1) === Char.CHAR_RIGHT_SQUARE_BRACKET
  );
}

// This prevents some common spoofing bugs due to our use of IDNA toASCII. For
// compatibility, the set of characters we use here is the *intersection* of
// "forbidden host code point" in the WHATWG URL Standard [1] and the
// characters in the host parsing loop in Url.prototype.parse, with the
// following additions:
//
// - ':' since this could cause a "protocol spoofing" bug
// - '@' since this could cause parts of the hostname to be confused with auth
// - '[' and ']' since this could cause a non-IPv6 hostname to be interpreted
//   as IPv6 by isIpv6Hostname above
//
// [1]: https://url.spec.whatwg.org/#forbidden-host-code-point
const forbiddenHostChars = /[\0\t\n\r #%/:<>?@[\\\]^|]/;
// For IPv6, permit '[', ']', and ':'.
const forbiddenHostCharsIpv6 = /[\0\t\n\r #%/<>?@\\^|]/;

Url.prototype.parse = function parse(url: string, parseQueryString?: boolean, slashesDenoteHost?: boolean): Url {
  validateString(url, "url");

  // Copy chrome, IE, opera backslash-handling behavior.
  // Back slashes before the query string get converted to forward slashes
  // See: https://code.google.com/p/chromium/issues/detail?id=25916
  let hasHash = false;
  let hasAt = false;
  let start = -1;
  let end = -1;
  let rest = "";
  let lastPos = 0;
  for (let i = 0, inWs = false, split = false; i < url.length; ++i) {
    const code = url.charCodeAt(i);

    // Find first and last non-whitespace characters for trimming
    const isWs = code < 33 || code === Char.CHAR_NO_BREAK_SPACE || code === Char.CHAR_ZERO_WIDTH_NOBREAK_SPACE;
    if (start === -1) {
      if (isWs) continue;
      lastPos = start = i;
    } else if (inWs) {
      if (!isWs) {
        end = -1;
        inWs = false;
      }
    } else if (isWs) {
      end = i;
      inWs = true;
    }

    // Only convert backslashes while we haven't seen a split character
    if (!split) {
      switch (code) {
        case Char.CHAR_AT:
          hasAt = true;
          break;
        case Char.CHAR_HASH:
          hasHash = true;
        // Fall through
        case Char.CHAR_QUESTION_MARK:
          split = true;
          break;
        case Char.CHAR_BACKWARD_SLASH:
          if (i - lastPos > 0) rest += url.slice(lastPos, i);
          rest += "/";
          lastPos = i + 1;
          break;
      }
    } else if (!hasHash && code === Char.CHAR_HASH) {
      hasHash = true;
    }
  }

  // Check if string was non-empty (including strings with only whitespace)
  if (start !== -1) {
    if (lastPos === start) {
      // We didn't convert any backslashes

      if (end === -1) {
        if (start === 0) rest = url;
        else rest = url.slice(start);
      } else {
        rest = url.slice(start, end);
      }
    } else if (end === -1 && lastPos < url.length) {
      // We converted some backslashes and have only part of the entire string
      rest += url.slice(lastPos);
    } else if (end !== -1 && lastPos < end) {
      // We converted some backslashes and have only part of the entire string
      rest += url.slice(lastPos, end);
    }
  }

  if (!slashesDenoteHost && !hasHash && !hasAt) {
    // Try fast path regexp
    const simplePath = simplePathPattern.exec(rest);
    if (simplePath) {
      this.path = rest;
      this.href = rest;
      this.pathname = simplePath[1];
      if (simplePath[2]) {
        this.search = simplePath[2];
        if (parseQueryString) {
          this.query = querystring().parse(this.search.slice(1));
        } else {
          this.query = this.search.slice(1);
        }
      } else if (parseQueryString) {
        this.search = null;
        this.query = { __proto__: null };
      }
      return this;
    }
  }

  let proto = protocolPattern.exec(rest);
  let lowerProto: string | undefined;
  if (proto) {
    lowerProto = proto[0].toLowerCase();
    this.protocol = lowerProto;
    rest = rest.slice(lowerProto.length);
  }

  // Figure out if it's got a host
  // user@server is *always* interpreted as a hostname, and url
  // resolution will treat //foo/bar as host=foo,path=bar because that's
  // how the browser resolves relative URLs.
  let slashes: boolean | undefined;
  if (slashesDenoteHost || proto || hostPattern.test(rest)) {
    slashes = rest.charCodeAt(0) === Char.CHAR_FORWARD_SLASH && rest.charCodeAt(1) === Char.CHAR_FORWARD_SLASH;
    if (slashes && !(proto && hostlessProtocol.has(lowerProto))) {
      rest = rest.slice(2);
      this.slashes = true;
    }
  }

  if (!hostlessProtocol.has(lowerProto) && (slashes || (proto && !slashedProtocol.has(proto)))) {
    // there's a hostname.
    // the first instance of /, ?, ;, or # ends the host.
    //
    // If there is an @ in the hostname, then non-host chars *are* allowed
    // to the left of the last @ sign, unless some host-ending character
    // comes *before* the @-sign.
    // URLs are obnoxious.
    //
    // ex:
    // http://a@b@c/ => user:a@b host:c
    // http://a@b?@c => user:a host:b path:/?@c

    let hostEnd = -1;
    let atSign = -1;
    let nonHost = -1;
    for (let i = 0; i < rest.length; ++i) {
      switch (rest.charCodeAt(i)) {
        case Char.CHAR_TAB:
        case Char.CHAR_LINE_FEED:
        case Char.CHAR_CARRIAGE_RETURN:
          // WHATWG URL removes tabs, newlines, and carriage returns. Let's do that too.
          rest = rest.slice(0, i) + rest.slice(i + 1);
          i -= 1;
          break;
        case Char.CHAR_SPACE:
        case Char.CHAR_DOUBLE_QUOTE:
        case Char.CHAR_PERCENT:
        case Char.CHAR_SINGLE_QUOTE:
        case Char.CHAR_SEMICOLON:
        case Char.CHAR_LEFT_ANGLE_BRACKET:
        case Char.CHAR_RIGHT_ANGLE_BRACKET:
        case Char.CHAR_BACKWARD_SLASH:
        case Char.CHAR_CIRCUMFLEX_ACCENT:
        case Char.CHAR_GRAVE_ACCENT:
        case Char.CHAR_LEFT_CURLY_BRACKET:
        case Char.CHAR_VERTICAL_LINE:
        case Char.CHAR_RIGHT_CURLY_BRACKET:
          // Characters that are never ever allowed in a hostname from RFC 2396
          if (nonHost === -1) nonHost = i;
          break;
        case Char.CHAR_HASH:
        case Char.CHAR_FORWARD_SLASH:
        case Char.CHAR_QUESTION_MARK:
          // Find the first instance of any host-ending characters
          if (nonHost === -1) nonHost = i;
          hostEnd = i;
          break;
        case Char.CHAR_AT:
          // At this point, either we have an explicit point where the
          // auth portion cannot go past, or the last @ char is the decider.
          atSign = i;
          nonHost = -1;
          break;
      }
      if (hostEnd !== -1) break;
    }
    start = 0;
    if (atSign !== -1) {
      this.auth = decodeURIComponent(rest.slice(0, atSign));
      start = atSign + 1;
    }
    if (nonHost === -1) {
      this.host = rest.slice(start);
      rest = "";
    } else {
      this.host = rest.slice(start, nonHost);
      rest = rest.slice(nonHost);
    }

    // pull out port.
    this.parseHost();

    // We've indicated that there is a hostname,
    // so even if it's empty, it has to be present.
    if (typeof this.hostname !== "string") this.hostname = "";

    const hostname = this.hostname;

    // If hostname begins with [ and ends with ]
    // assume that it's an IPv6 address.
    const ipv6Hostname = isIpv6Hostname(hostname);

    // validate a little.
    if (!ipv6Hostname) {
      rest = getHostname(this, rest, hostname, url);
    }

    if (this.hostname.length > hostnameMaxLen) {
      this.hostname = "";
    } else {
      // Hostnames are always lower case.
      this.hostname = this.hostname.toLowerCase();
    }

    if (this.hostname !== "") {
      if (ipv6Hostname) {
        if (forbiddenHostCharsIpv6.test(this.hostname)) {
          throw $ERR_INVALID_URL(url);
        }
      } else {
        // IDNA Support: Returns a punycoded representation of "domain".
        // It only converts parts of the domain name that
        // have non-ASCII characters, i.e. it doesn't matter if
        // you call it with a domain that already is ASCII-only.
        this.hostname = domainToASCII(this.hostname);

        // Prevent two potential routes of hostname spoofing.
        // 1. If this.hostname is empty, it must have become empty due to toASCII
        //    since we checked this.hostname above.
        // 2. If any of forbiddenHostChars appears in this.hostname, it must have
        //    also gotten in due to toASCII. This is since getHostname would have
        //    filtered them out otherwise.
        // Rather than trying to correct this by moving the non-host part into
        // the pathname as we've done in getHostname, throw an exception to
        // convey the severity of this issue.
        if (this.hostname === "" || forbiddenHostChars.test(this.hostname)) {
          throw $ERR_INVALID_URL(url);
        }
      }
    }

    const p = this.port ? ":" + this.port : "";
    const h = this.hostname || "";
    this.host = h + p;

    // strip [ and ] from the hostname
    // the host field still retains them, though
    if (ipv6Hostname) {
      this.hostname = this.hostname.slice(1, -1);
      if (rest[0] !== "/") {
        rest = "/" + rest;
      }
    }
  }

  // Now rest is set to the post-host stuff.
  // Chop off any delim chars.
  if (!unsafeProtocol.has(lowerProto)) {
    // First, make 100% sure that any "autoEscape" chars get
    // escaped, even if encodeURIComponent doesn't think they
    // need to be.
    rest = autoEscapeStr(rest);
  }

  let questionIdx = -1;
  let hashIdx = -1;
  for (let i = 0; i < rest.length; ++i) {
    const code = rest.charCodeAt(i);
    if (code === Char.CHAR_HASH) {
      this.hash = rest.slice(i);
      hashIdx = i;
      break;
    } else if (code === Char.CHAR_QUESTION_MARK && questionIdx === -1) {
      questionIdx = i;
    }
  }

  if (questionIdx !== -1) {
    if (hashIdx === -1) {
      this.search = rest.slice(questionIdx);
      this.query = rest.slice(questionIdx + 1);
    } else {
      this.search = rest.slice(questionIdx, hashIdx);
      this.query = rest.slice(questionIdx + 1, hashIdx);
    }
    if (parseQueryString) {
      this.query = querystring().parse(this.query);
    }
  } else if (parseQueryString) {
    // No query string, but parseQueryString still requested
    this.search = null;
    this.query = { __proto__: null };
  }

  const useQuestionIdx = questionIdx !== -1 && (hashIdx === -1 || questionIdx < hashIdx);
  const firstIdx = useQuestionIdx ? questionIdx : hashIdx;
  if (firstIdx === -1) {
    if (rest.length > 0) this.pathname = rest;
  } else if (firstIdx > 0) {
    this.pathname = rest.slice(0, firstIdx);
  }
  if (slashedProtocol.has(lowerProto) && this.hostname && !this.pathname) {
    this.pathname = "/";
  }

  // To support http.request
  if (this.pathname || this.search) {
    const p = this.pathname || "";
    const s = this.search || "";
    this.path = p + s;
  }

  // Finally, reconstruct the href based on what has been validated.
  this.href = this.format();
  return this;
};

let warnInvalidPort = true;
function getHostname(self: Url, rest: string, hostname: string, url: string) {
  for (let i = 0; i < hostname.length; ++i) {
    const code = hostname.charCodeAt(i);
    const isValid =
      code !== Char.CHAR_FORWARD_SLASH &&
      code !== Char.CHAR_BACKWARD_SLASH &&
      code !== Char.CHAR_HASH &&
      code !== Char.CHAR_QUESTION_MARK &&
      code !== Char.CHAR_COLON;

    if (!isValid) {
      // If leftover starts with :, then it represents an invalid port.
      // But url.parse() is lenient about it for now.
      // Issue a warning and continue.
      if (warnInvalidPort && code === Char.CHAR_COLON) {
        const detail = `The URL ${url} is invalid. Future versions of Node.js will throw an error.`;
        process.emitWarning(detail, "DeprecationWarning", "DEP0170");
        warnInvalidPort = false;
      }
      self.hostname = hostname.slice(0, i);
      return `/${hostname.slice(i)}${rest}`;
    }
  }
  return rest;
}

// Escaped characters. Use empty strings to fill up unused entries.
// Using Array is faster than Object/Map
// prettier-ignore
const escapedCodes = [
  /* 0 - 9 */ '', '', '', '', '', '', '', '', '', '%09',
  /* 10 - 19 */ '%0A', '', '', '%0D', '', '', '', '', '', '',
  /* 20 - 29 */ '', '', '', '', '', '', '', '', '', '',
  /* 30 - 39 */ '', '', '%20', '', '%22', '', '', '', '', '%27',
  /* 40 - 49 */ '', '', '', '', '', '', '', '', '', '',
  /* 50 - 59 */ '', '', '', '', '', '', '', '', '', '',
  /* 60 - 69 */ '%3C', '', '%3E', '', '', '', '', '', '', '',
  /* 70 - 79 */ '', '', '', '', '', '', '', '', '', '',
  /* 80 - 89 */ '', '', '', '', '', '', '', '', '', '',
  /* 90 - 99 */ '', '', '%5C', '', '%5E', '', '%60', '', '', '',
  /* 100 - 109 */ '', '', '', '', '', '', '', '', '', '',
  /* 110 - 119 */ '', '', '', '', '', '', '', '', '', '',
  /* 120 - 125 */ '', '', '', '%7B', '%7C', '%7D',
];

// Automatically escape all delimiters and unwise characters from RFC 2396.
// Also escape single quotes in case of an XSS attack.
// Return the escaped string.
function autoEscapeStr(rest: string): string {
  let escaped = "";
  let lastEscapedPos = 0;
  for (let i = 0; i < rest.length; ++i) {
    // `escaped` contains substring up to the last escaped character.
    const escapedChar = escapedCodes[rest.charCodeAt(i)];
    if (escapedChar) {
      // Concat if there are ordinary characters in the middle.
      if (i > lastEscapedPos) escaped += rest.slice(lastEscapedPos, i);
      escaped += escapedChar;
      lastEscapedPos = i + 1;
    }
  }
  if (lastEscapedPos === 0)
    // Nothing has been escaped.
    return rest;

  // There are ordinary characters at the end.
  if (lastEscapedPos < rest.length) escaped += rest.slice(lastEscapedPos);

  return escaped;
}

// Format a parsed object into a url string
function urlFormat(
  urlObject: UrlLike,
  options?: { fragment?: boolean; unicode?: boolean; search?: boolean; auth?: boolean },
): string {
  // Ensure it's an object, and not a string url.
  // If it's an object, this is a no-op.
  // this way, you can call urlParse() on strings
  // to clean up potentially wonky urls.
  if (typeof urlObject === "string") {
    urlObject = urlParse(urlObject);
  } else if (typeof urlObject !== "object" || urlObject === null) {
    throw $ERR_INVALID_ARG_TYPE("urlObject", ["Object", "string"], urlObject);
  }

  if (!(urlObject instanceof Url)) {
    return Url.prototype.format.$call(urlObject);
  }
  return urlObject.format();
}

// These characters do not need escaping:
// ! - . _ ~
// ' ( ) * :
// digits
// alpha (uppercase)
// alpha (lowercase)
// prettier-ignore
const noEscapeAuth = new Int8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0x00 - 0x0F
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0x10 - 0x1F
  0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, // 0x20 - 0x2F
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, // 0x30 - 0x3F
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 0x40 - 0x4F
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, // 0x50 - 0x5F
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 0x60 - 0x6F
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, // 0x70 - 0x7F
]);

Url.prototype.format = function format(): string {
  let auth = this.auth || "";
  if (auth) {
    auth = encodeStr(auth, noEscapeAuth, hexTable);
    auth += "@";
  }

  let protocol = this.protocol || "";
  let pathname = this.pathname || "";
  let hash = this.hash || "";
  let host = "";
  let query = "";

  if (this.host) {
    host = auth + this.host;
  } else if (this.hostname) {
    host =
      auth +
      (this.hostname.includes(":") && !isIpv6Hostname(this.hostname) ? "[" + this.hostname + "]" : this.hostname);
    if (this.port) {
      host += ":" + this.port;
    }
  }

  if (this.query !== null && typeof this.query === "object") {
    // Use URLSearchParams instead of querystring to avoid loading the module
    // Node.js does: querystring().stringify(this.query);
    query = new URLSearchParams(this.query).toString();
  }

  let search = this.search || (query && "?" + query) || "";

  if (protocol && protocol.charCodeAt(protocol.length - 1) !== 58 /* : */) protocol += ":";

  let newPathname = "";
  let lastPos = 0;
  for (let i = 0; i < pathname.length; ++i) {
    switch (pathname.charCodeAt(i)) {
      case Char.CHAR_HASH:
        if (i - lastPos > 0) newPathname += pathname.slice(lastPos, i);
        newPathname += "%23";
        lastPos = i + 1;
        break;
      case Char.CHAR_QUESTION_MARK:
        if (i - lastPos > 0) newPathname += pathname.slice(lastPos, i);
        newPathname += "%3F";
        lastPos = i + 1;
        break;
    }
  }
  if (lastPos > 0) {
    if (lastPos !== pathname.length) pathname = newPathname + pathname.slice(lastPos);
    else pathname = newPathname;
  }

  // Only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
  // unless they had them to begin with.
  if (this.slashes || slashedProtocol.has(protocol)) {
    if (this.slashes || host) {
      if (pathname && pathname.charCodeAt(0) !== Char.CHAR_FORWARD_SLASH) pathname = "/" + pathname;
      host = "//" + host;
    } else if (
      protocol.length >= 4 &&
      protocol.charCodeAt(0) === 102 /* f */ &&
      protocol.charCodeAt(1) === 105 /* i */ &&
      protocol.charCodeAt(2) === 108 /* l */ &&
      protocol.charCodeAt(3) === 101 /* e */
    ) {
      host = "//";
    }
  }

  search = search.replaceAll("#", "%23");

  if (hash && hash.charCodeAt(0) !== Char.CHAR_HASH) hash = "#" + hash;
  if (search && search.charCodeAt(0) !== Char.CHAR_QUESTION_MARK) search = "?" + search;

  return protocol + host + pathname + search + hash;
};

function urlResolve(source: UrlLike, relative: UrlLike): UrlLike {
  return urlParse(source, false, true).resolve(relative);
}

Url.prototype.resolve = function resolve(relative: UrlLike): UrlLike {
  return this.resolveObject(urlParse(relative, false, true)).format();
};

function urlResolveObject(source: UrlLike, relative: UrlLike): UrlLike {
  if (!source) return relative;
  return urlParse(source, false, true).resolveObject(relative);
}

Url.prototype.resolveObject = function resolveObject(relative: UrlLike): UrlLike {
  if (typeof relative === "string") {
    const rel = new Url();
    rel.parse(relative, false, true);
    relative = rel;
  }

  const result = new Url();
  ObjectAssign(result, this);

  // Hash is always overridden, no matter what.
  // even href="" will remove it.
  result.hash = relative.hash;

  // If the relative url is empty, then there's nothing left to do here.
  if (relative.href === "") {
    result.href = result.format();
    return result;
  }

  // Hrefs like //foo/bar always cut to the protocol.
  if (relative.slashes && !relative.protocol) {
    // Take everything except the protocol from relative
    const relativeWithoutProtocol = ObjectKeys(relative).reduce((acc, key) => {
      if (key !== "protocol") {
        acc[key] = relative[key];
      }
      return acc;
    }, {});
    ObjectAssign(result, relativeWithoutProtocol);

    // urlParse appends trailing / to urls like http://www.example.com
    if (slashedProtocol.has(result.protocol) && result.hostname && !result.pathname) {
      result.path = result.pathname = "/";
    }

    result.href = result.format();
    return result;
  }

  if (relative.protocol && relative.protocol !== result.protocol) {
    // If it's a known url protocol, then changing
    // the protocol does weird things
    // first, if it's not file:, then we MUST have a host,
    // and if there was a path
    // to begin with, then we MUST have a path.
    // if it is file:, then the host is dropped,
    // because that's known to be hostless.
    // anything else is assumed to be absolute.
    if (!slashedProtocol.has(relative.protocol)) {
      ObjectAssign(result, relative);
      result.href = result.format();
      return result;
    }

    result.protocol = relative.protocol;
    if (!relative.host && !/^file:?$/.test(relative.protocol) && !hostlessProtocol.has(relative.protocol)) {
      const relPath = (relative.pathname || "").split("/");
      while (relPath.length && !(relative.host = relPath.shift()));
      relative.host ||= "";
      relative.hostname ||= "";
      if (relPath[0] !== "") relPath.unshift("");
      if (relPath.length < 2) relPath.unshift("");
      result.pathname = relPath.join("/");
    } else {
      result.pathname = relative.pathname;
    }
    result.search = relative.search;
    result.query = relative.query;
    result.host = relative.host || "";
    result.auth = relative.auth;
    result.hostname = relative.hostname || relative.host;
    result.port = relative.port;
    // To support http.request
    if (result.pathname || result.search) {
      const p = result.pathname || "";
      const s = result.search || "";
      result.path = p + s;
    }
    result.slashes ||= relative.slashes;
    result.href = result.format();
    return result;
  }

  const isSourceAbs = result.pathname && result.pathname.charAt(0) === "/";
  const isRelAbs = relative.host || (relative.pathname && relative.pathname.charAt(0) === "/");
  let mustEndAbs = isRelAbs || isSourceAbs || (result.host && relative.pathname);
  const removeAllDots = mustEndAbs;
  let srcPath = (result.pathname && result.pathname.split("/")) || [];
  const relPath = (relative.pathname && relative.pathname.split("/")) || [];
  const noLeadingSlashes = result.protocol && !slashedProtocol.has(result.protocol);

  // If the url is a non-slashed url, then relative
  // links like ../.. should be able
  // to crawl up to the hostname, as well.  This is strange.
  // result.protocol has already been set by now.
  // Later on, put the first path part into the host field.
  if (noLeadingSlashes) {
    result.hostname = "";
    result.port = null;
    if (result.host) {
      if (srcPath[0] === "") srcPath[0] = result.host;
      else srcPath.unshift(result.host);
    }
    result.host = "";
    if (relative.protocol) {
      relative.hostname = null;
      relative.port = null;
      result.auth = null;
      if (relative.host) {
        if (relPath[0] === "") relPath[0] = relative.host;
        else relPath.unshift(relative.host);
      }
      relative.host = null;
    }
    mustEndAbs &&= relPath[0] === "" || srcPath[0] === "";
  }

  if (isRelAbs) {
    // it's absolute.
    if (relative.host || relative.host === "") {
      if (result.host !== relative.host) result.auth = null;
      result.host = relative.host;
      result.port = relative.port;
    }
    if (relative.hostname || relative.hostname === "") {
      if (result.hostname !== relative.hostname) result.auth = null;
      result.hostname = relative.hostname;
    }
    result.search = relative.search;
    result.query = relative.query;
    srcPath = relPath;
    // Fall through to the dot-handling below.
  } else if (relPath.length) {
    // it's relative
    // throw away the existing file, and take the new path instead.
    srcPath ||= [];
    srcPath.pop();
    srcPath = srcPath.concat(relPath);
    result.search = relative.search;
    result.query = relative.query;
  } else if (relative.search !== null && relative.search !== undefined) {
    // Just pull out the search.
    // like href='?foo'.
    // Put this after the other two cases because it simplifies the booleans
    if (noLeadingSlashes) {
      result.hostname = result.host = srcPath.shift();
      // Occasionally the auth can get stuck only in host.
      // This especially happens in cases like
      // url.resolveObject('mailto:local1@domain1', 'local2@domain2')
      const authInHost = result.host && result.host.indexOf("@") > 0 && result.host.split("@");
      if (authInHost) {
        result.auth = authInHost.shift();
        result.host = result.hostname = authInHost.shift();
      }
    }
    result.search = relative.search;
    result.query = relative.query;
    // To support http.request
    if (result.pathname !== null || result.search !== null) {
      result.path = (result.pathname ? result.pathname : "") + (result.search ? result.search : "");
    }
    result.href = result.format();
    return result;
  }

  if (!srcPath.length) {
    // No path at all. All other things were already handled above.
    result.pathname = null;
    // To support http.request
    if (result.search) {
      result.path = "/" + result.search;
    } else {
      result.path = null;
    }
    result.href = result.format();
    return result;
  }

  // If a url ENDs in . or .., then it must get a trailing slash.
  // however, if it ends in anything else non-slashy,
  // then it must NOT get a trailing slash.
  let last = srcPath.slice(-1)[0];
  const hasTrailingSlash =
    ((result.host || relative.host || srcPath.length > 1) && (last === "." || last === "..")) || last === "";

  // Strip single dots, resolve double dots to parent dir
  // if the path tries to go above the root, `up` ends up > 0
  let up = 0;
  for (let i = srcPath.length - 1; i >= 0; i--) {
    last = srcPath[i];
    if (last === ".") {
      spliceOne(srcPath, i);
    } else if (last === "..") {
      spliceOne(srcPath, i);
      up++;
    } else if (up) {
      spliceOne(srcPath, i);
      up--;
    }
  }

  // If the path is allowed to go above the root, restore leading ..s
  if (!mustEndAbs && !removeAllDots) {
    while (up--) {
      srcPath.unshift("..");
    }
  }

  if (mustEndAbs && srcPath[0] !== "" && (!srcPath[0] || srcPath[0].charAt(0) !== "/")) {
    srcPath.unshift("");
  }

  if (hasTrailingSlash && srcPath.join("/").slice(-1) !== "/") {
    srcPath.push("");
  }

  const isAbsolute = srcPath[0] === "" || (srcPath[0] && srcPath[0].charAt(0) === "/");

  // put the host back
  if (noLeadingSlashes) {
    result.hostname = result.host = isAbsolute ? "" : srcPath.length ? srcPath.shift() : "";
    // Occasionally the auth can get stuck only in host.
    // This especially happens in cases like
    // url.resolveObject('mailto:local1@domain1', 'local2@domain2')
    const authInHost = result.host && result.host.indexOf("@") > 0 ? result.host.split("@") : false;
    if (authInHost) {
      result.auth = authInHost.shift();
      result.host = result.hostname = authInHost.shift();
    }
  }

  mustEndAbs ||= result.host && srcPath.length;

  if (mustEndAbs && !isAbsolute) {
    srcPath.unshift("");
  }

  if (!srcPath.length) {
    result.pathname = null;
    result.path = null;
  } else {
    result.pathname = srcPath.join("/");
  }

  // To support request.http
  if (result.pathname !== null || result.search !== null) {
    result.path = (result.pathname ? result.pathname : "") + (result.search ? result.search : "");
  }
  result.auth = relative.auth || result.auth;
  result.slashes ||= relative.slashes;
  result.href = result.format();
  return result;
};

Url.prototype.parseHost = function parseHost() {
  let host = this.host;
  const portMatch = portPattern.exec(host);
  if (portMatch) {
    const port = portMatch[0];
    if (port !== ":") {
      this.port = port.slice(1);
    }
    host = host.slice(0, host.length - port.length);
  }
  if (host) this.hostname = host;
};

const hexTable = new Array(256);
for (let i = 0; i < 256; ++i)
  hexTable[i] = "%" + StringPrototypeToUpperCase((i < 16 ? "0" : "") + NumberPrototypeToString(i, 16));

function encodeStr(str: string, noEscapeTable: Int8Array, hexTable: string[]) {
  const len = str.length;
  if (len === 0) return "";

  let out = "";
  let lastPos = 0;
  let i = 0;

  outer: for (; i < len; i++) {
    let c = StringPrototypeCharCodeAt(str, i);

    // ASCII
    while (c < 0x80) {
      if (noEscapeTable[c] !== 1) {
        if (lastPos < i) out += StringPrototypeSlice(str, lastPos, i);
        lastPos = i + 1;
        out += hexTable[c];
      }

      if (++i === len) break outer;

      c = StringPrototypeCharCodeAt(str, i);
    }

    if (lastPos < i) out += StringPrototypeSlice(str, lastPos, i);

    // Multi-byte characters ...
    if (c < 0x800) {
      lastPos = i + 1;
      out += hexTable[0xc0 | (c >> 6)] + hexTable[0x80 | (c & 0x3f)];
      continue;
    }
    if (c < 0xd800 || c >= 0xe000) {
      lastPos = i + 1;
      out += hexTable[0xe0 | (c >> 12)] + hexTable[0x80 | ((c >> 6) & 0x3f)] + hexTable[0x80 | (c & 0x3f)];
      continue;
    }
    // Surrogate pair
    ++i;

    // This branch should never happen because all URLSearchParams entries
    // should already be converted to USVString. But, included for
    // completion's sake anyway.
    if (i >= len) throw $ERR_INVALID_URI("URI malformed");

    const c2 = StringPrototypeCharCodeAt(str, i) & 0x3ff;

    lastPos = i + 1;
    c = 0x10000 + (((c & 0x3ff) << 10) | c2);
    out +=
      hexTable[0xf0 | (c >> 18)] +
      hexTable[0x80 | ((c >> 12) & 0x3f)] +
      hexTable[0x80 | ((c >> 6) & 0x3f)] +
      hexTable[0x80 | (c & 0x3f)];
  }
  if (lastPos === 0) return str;
  if (lastPos < len) return out + StringPrototypeSlice(str, lastPos);
  return out;
}

// As of V8 6.6, depending on the size of the array, this is anywhere
// between 1.5-10x faster than the two-arg version of Array#splice()
function spliceOne(list: string[], index: number) {
  for (; index + 1 < list.length; index++) list[index] = list[index + 1];
  list.pop();
}

export default {
  // Original API
  Url,
  parse: urlParse,
  resolve: urlResolve,
  resolveObject: urlResolveObject,
  format: urlFormat,

  // WHATWG API
  URL,
  // URLPattern,
  URLSearchParams,
  domainToASCII,
  domainToUnicode,

  // Utilities
  pathToFileURL: Bun.pathToFileURL,
  fileURLToPath: Bun.fileURLToPath,
  urlToHttpOptions,
};
