/// <reference path="../builtins.d.ts" />

/*
 * Copyright Joyent, Inc. and other Node contributors.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit
 * persons to whom the Software is furnished to do so, subject to the
 * following conditions:
 *
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
 * NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 * USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

"use strict";

const { URL, URLSearchParams, URLPattern } = globalThis;
const [domainToASCII, domainToUnicode, idnaToASCII] = $cpp("NodeURL.cpp", "Bun::createNodeURLBinding");
const { urlToHttpOptions } = require("internal/url");
const { validateString, validateObject } = require("internal/validators");
const ObjectSetPrototypeOf = Object.setPrototypeOf;

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

/*
 * define these here so at least they only have to be
 * compiled once on the first module load.
 */
var protocolPattern = /^([a-z0-9.+-]+:)/i,
  portPattern = /:[0-9]*$/,
  // Special case for a simple path URL
  simplePathPattern = /^(\/\/?(?!\/)[^?\s]*)(\?[^\s]*)?$/,
  /*
   * RFC 2396: characters reserved for delimiting URLs.
   * We actually just auto-escape these.
   */
  delims = ["<", ">", '"', "`", " ", "\r", "\n", "\t"],
  // RFC 2396: characters not allowed for various reasons.
  unwise = ["{", "}", "|", "\\", "^", "`"].concat(delims),
  // Allowed by RFCs, but cause of XSS attacks.  Always escape these.
  autoEscape = ["'"].concat(unwise),
  // Characters never allowed in a hostname (post-IDNA) / bracketed IPv6 hostname.
  forbiddenHostChars = /[\0\t\n\r #%/:<>?@[\\\]^|]/,
  forbiddenHostCharsIpv6 = /[\0\t\n\r #%/<>?@\\^|]/,
  hostnameMaxLen = 255,
  // protocols that can allow "unsafe" and "unwise" chars.
  unsafeProtocol = {
    __proto__: null,
    javascript: true,
    "javascript:": true,
  },
  // protocols that never have a hostname.
  hostlessProtocol = {
    __proto__: null,
    javascript: true,
    "javascript:": true,
  },
  // protocols that always contain a // bit.
  slashedProtocol = {
    __proto__: null,
    http: true,
    https: true,
    ftp: true,
    gopher: true,
    file: true,
    ws: true,
    wss: true,
    "http:": true,
    "https:": true,
    "ftp:": true,
    "gopher:": true,
    "file:": true,
    "ws:": true,
    "wss:": true,
  };

function urlParse(
  url: string | URL | typeof Url, // really has unknown type but intellisense is nice
  parseQueryString?: boolean,
  slashesDenoteHost?: boolean,
) {
  if ($isObject(url) && url instanceof Url) return url;

  var u = new Url();
  try {
    u.parse(url, parseQueryString, slashesDenoteHost);
  } catch (e) {
    $putByIdDirect(e, "input", url);
    throw e;
  }
  return u;
}

Url.prototype.parse = function parse(url: string, parseQueryString?: boolean, slashesDenoteHost?: boolean) {
  validateString(url, "url");

  /*
   * Copy chrome, IE, opera backslash-handling behavior.
   * Back slashes before the query string get converted to forward slashes
   * See: https://code.google.com/p/chromium/issues/detail?id=25916
   */
  let hasHash = false;
  let hasAt = false;
  let start = -1;
  let end = -1;
  let rest = "";
  let lastPos = 0;
  for (let i = 0, inWs = false, split = false; i < url.length; ++i) {
    const code = url.$charCodeAt(i);

    // Find first and last non-whitespace characters for trimming
    const isWs = code < 33 || code === Char.NO_BREAK_SPACE || code === Char.ZERO_WIDTH_NOBREAK_SPACE;
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
        case Char.AT:
          hasAt = true;
          break;
        case Char.HASH:
          hasHash = true;
        // Fall through
        case Char.QUESTION_MARK:
          split = true;
          break;
        case Char.BACKWARD_SLASH:
          if (i - lastPos > 0) rest += url.slice(lastPos, i);
          rest += "/";
          lastPos = i + 1;
          break;
      }
    } else if (!hasHash && code === Char.HASH) {
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
          this.query = ObjectSetPrototypeOf(new URLSearchParams(this.search.slice(1)).toJSON(), null);
        } else {
          this.query = this.search.slice(1);
        }
      } else if (parseQueryString) {
        this.search = null;
        this.query = Object.create(null);
      }
      return this;
    }
  }

  var proto: any = protocolPattern.exec(rest);
  if (proto) {
    proto = proto[0];
    var lowerProto = proto.toLowerCase();
    this.protocol = lowerProto;
    rest = rest.substring(proto.length);
  }

  /*
   * figure out if it's got a host
   * user@server is *always* interpreted as a hostname, and url
   * resolution will treat //foo/bar as host=foo,path=bar because that's
   * how the browser resolves relative URLs.
   */
  let slashes;
  if (slashesDenoteHost || proto || rest.match(/^\/\/[^@/]+@[^@/]+/)) {
    slashes = rest.substring(0, 2) === "//";
    if (slashes && !(proto && hostlessProtocol[lowerProto])) {
      rest = rest.substring(2);
      this.slashes = true;
    }
  }

  if (!hostlessProtocol[lowerProto] && (slashes || (lowerProto && !slashedProtocol[lowerProto]))) {
    /*
     * there's a hostname.
     * the first instance of /, ?, ;, or # ends the host.
     *
     * If there is an @ in the hostname, then non-host chars *are* allowed
     * to the left of the last @ sign, unless some host-ending character
     * comes *before* the @-sign.
     * URLs are obnoxious.
     *
     * ex:
     * http://a@b@c/ => user:a@b host:c
     * http://a@b?@c => user:a host:c path:/?@c
     */

    let hostEnd = -1;
    let atSign = -1;
    let nonHost = -1;
    for (let i = 0; i < rest.length; ++i) {
      switch (rest.$charCodeAt(i)) {
        case Char.TAB:
        case Char.LINE_FEED:
        case Char.CARRIAGE_RETURN:
          // WHATWG URL removes tabs, newlines, and carriage returns. Let's do that too.
          rest = rest.slice(0, i) + rest.slice(i + 1);
          i -= 1;
          break;
        case Char.SPACE:
        case Char.DOUBLE_QUOTE:
        case Char.PERCENT:
        case Char.SINGLE_QUOTE:
        case Char.SEMICOLON:
        case Char.LEFT_ANGLE_BRACKET:
        case Char.RIGHT_ANGLE_BRACKET:
        case Char.BACKWARD_SLASH:
        case Char.CIRCUMFLEX_ACCENT:
        case Char.GRAVE_ACCENT:
        case Char.LEFT_CURLY_BRACKET:
        case Char.VERTICAL_LINE:
        case Char.RIGHT_CURLY_BRACKET:
          // Characters that are never ever allowed in a hostname from RFC 2396
          if (nonHost === -1) nonHost = i;
          break;
        case Char.HASH:
        case Char.FORWARD_SLASH:
        case Char.QUESTION_MARK:
          // Find the first instance of any host-ending characters
          if (nonHost === -1) nonHost = i;
          hostEnd = i;
          break;
        case Char.AT:
          // At this point, either we have an explicit point where the
          // auth portion cannot go past, or the last @ char is the decider.
          atSign = i;
          nonHost = -1;
          break;
      }
      if (hostEnd !== -1) break;
    }
    let authStart = 0;
    if (atSign !== -1) {
      this.auth = decodeURIComponent(rest.slice(0, atSign));
      authStart = atSign + 1;
    }
    if (nonHost === -1) {
      this.host = rest.slice(authStart);
      rest = "";
    } else {
      this.host = rest.slice(authStart, nonHost);
      rest = rest.slice(nonHost);
    }

    // pull out port.
    this.parseHost();

    /*
     * we've indicated that there is a hostname,
     * so even if it's empty, it has to be present.
     */
    if (typeof this.hostname !== "string") {
      this.hostname = "";
    }
    const hostname = this.hostname;

    /*
     * if hostname begins with [ and ends with ]
     * assume that it's an IPv6 address.
     */
    var ipv6Hostname = isIpv6Hostname(this.hostname);

    // validate a little.
    if (!ipv6Hostname) {
      rest = getHostname(this, rest, hostname, url);
    }

    if (this.hostname.length > hostnameMaxLen) {
      this.hostname = "";
    } else {
      // hostnames are always lower case.
      this.hostname = this.hostname.toLowerCase();
    }

    if (this.hostname !== "") {
      if (ipv6Hostname) {
        // IPv6 literals stay as written (Node only lowercases them).
        if (forbiddenHostCharsIpv6.test(this.hostname)) {
          throw $ERR_INVALID_URL(url);
        }
      } else {
        /*
         * IDNA Support: Returns a punycoded representation of "domain".
         * It only converts parts of the domain name that
         * have non-ASCII characters, i.e. it doesn't matter if
         * you call it with a domain that already is ASCII-only.
         */
        this.hostname = idnaToASCII(this.hostname);

        /*
         * Prevent two potential routes of hostname spoofing (see Node):
         * an empty result or forbidden chars can only come from toASCII.
         */
        if (this.hostname === "" || forbiddenHostChars.test(this.hostname)) {
          throw $ERR_INVALID_URL(url);
        }
      }
    }

    var p = this.port ? ":" + this.port : "";
    var h = this.hostname || "";
    this.host = h + p;
    this.href += this.host;

    /*
     * strip [ and ] from the hostname
     * the host field still retains them, though
     */
    if (ipv6Hostname) {
      this.hostname = this.hostname.slice(1, -1);
      if (rest[0] !== "/") {
        rest = "/" + rest;
      }
    }
  }

  /*
   * now rest is set to the post-host stuff.
   * chop off any delim chars.
   */
  if (!unsafeProtocol[lowerProto]) {
    /*
     * First, make 100% sure that any "autoEscape" chars get
     * escaped, even if encodeURIComponent doesn't think they
     * need to be.
     */
    for (var i = 0, l = autoEscape.length; i < l; i++) {
      var ae = autoEscape[i];
      if (rest.indexOf(ae) === -1) {
        continue;
      }
      var esc = encodeURIComponent(ae);
      if (esc === ae) {
        esc = escape(ae);
      }
      rest = rest.split(ae).join(esc);
    }
  }

  // chop off from the tail first.
  var hash = rest.indexOf("#");
  if (hash !== -1) {
    // got a fragment string.
    this.hash = rest.substring(hash);
    rest = rest.slice(0, hash);
  }
  var qm = rest.indexOf("?");
  if (qm !== -1) {
    this.search = rest.substring(qm);
    this.query = rest.substring(qm + 1);
    if (parseQueryString) {
      const query = this.query;
      this.query = ObjectSetPrototypeOf(new URLSearchParams(query).toJSON(), null);
    }
    rest = rest.slice(0, qm);
  } else if (parseQueryString) {
    // no query string, but parseQueryString still requested
    this.search = null;
    this.query = Object.create(null);
  }
  if (rest) {
    this.pathname = rest;
  }
  if (slashedProtocol[lowerProto] && this.hostname && !this.pathname) {
    this.pathname = "/";
  }

  // to support http.request
  const pathname = this.pathname;
  let search;
  if (pathname || (search = this.search)) {
    this.path = (pathname || "") + ((search ?? this.search) || "");
  }

  // finally, reconstruct the href based on what has been validated.
  this.href = this.format();
  return this;
};

// Same as node's lib/url.js noEscapeAuth table (noEscape plus the colon).
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

const hexTable = new Array(256);
for (let i = 0; i < 256; ++i) hexTable[i] = "%" + ((i < 16 ? "0" : "") + i.toString(16)).toUpperCase();

// Port of node's internal/querystring encodeStr, used for auth encoding.
function encodeStr(str: string, noEscapeTable: Int8Array, hexTable: string[]) {
  const len = str.length;
  if (len === 0) return "";

  let out = "";
  let lastPos = 0;
  let i = 0;

  outer: for (; i < len; i++) {
    let c = str.$charCodeAt(i);

    // ASCII
    while (c < 0x80) {
      if (noEscapeTable[c] !== 1) {
        if (lastPos < i) out += str.slice(lastPos, i);
        lastPos = i + 1;
        out += hexTable[c];
      }

      if (++i === len) break outer;

      c = str.$charCodeAt(i);
    }

    if (lastPos < i) out += str.slice(lastPos, i);

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

    if (i >= len) throw $ERR_INVALID_URI();

    const c2 = str.$charCodeAt(i) & 0x3ff;

    lastPos = i + 1;
    c = 0x10000 + (((c & 0x3ff) << 10) | c2);
    out +=
      hexTable[0xf0 | (c >> 18)] +
      hexTable[0x80 | ((c >> 12) & 0x3f)] +
      hexTable[0x80 | ((c >> 6) & 0x3f)] +
      hexTable[0x80 | (c & 0x3f)];
  }
  if (lastPos === 0) return str;
  if (lastPos < len) return out + str.slice(lastPos);
  return out;
}

function isIpv6Hostname(hostname: string) {
  return (
    hostname.$charCodeAt(0) === Char.LEFT_SQUARE_BRACKET &&
    hostname.$charCodeAt($toLength(hostname.length - 1)) === Char.RIGHT_SQUARE_BRACKET
  );
}

let warnInvalidPort = true;
function getHostname(self, rest, hostname: string, url) {
  for (let i = 0; i < hostname.length; ++i) {
    const code = hostname.$charCodeAt(i);
    const isValid =
      code !== Char.FORWARD_SLASH &&
      code !== Char.BACKWARD_SLASH &&
      code !== Char.HASH &&
      code !== Char.QUESTION_MARK &&
      code !== Char.COLON;

    if (!isValid) {
      // If leftover starts with :, then it represents an invalid port.
      // But url.parse() is lenient about it for now.
      // Issue a warning and continue.
      if (warnInvalidPort && code === Char.COLON) {
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

// format a parsed object into a url string
declare function urlFormat(urlObject: string | URL | Url, options?: object): string;
function urlFormat(urlObject: unknown, options?: unknown) {
  /*
   * ensure it's an object, and not a string url.
   * If it's an obj, this is a no-op.
   * this way, you can call url_format() on strings
   * to clean up potentially wonky urls.
   */
  if (typeof urlObject === "string") {
    urlObject = urlParse(urlObject);
    // NOTE: $isObject returns true for functions
  } else if (typeof urlObject !== "object" || urlObject === null) {
    throw $ERR_INVALID_ARG_TYPE("urlObject", ["Object", "string"], urlObject);
  } else if (urlObject instanceof URL) {
    let fragment = true;
    let unicode = false;
    let search = true;
    let auth = true;

    if (options) {
      validateObject(options, "options");

      if ((options as any).fragment != null) {
        fragment = Boolean((options as any).fragment);
      }

      if ((options as any).unicode != null) {
        unicode = Boolean((options as any).unicode);
      }

      if ((options as any).search != null) {
        search = Boolean((options as any).search);
      }

      if ((options as any).auth != null) {
        auth = Boolean((options as any).auth);
      }
    }

    return formatWhatwgURL(urlObject, fragment, unicode, search, auth);
  }

  if (!(urlObject instanceof Url)) {
    return Url.prototype.format.$call(urlObject);
  }
  return urlObject.format();
}

// Mirrors Node's internal WHATWG URL formatter (bindingUrl.format).
function formatWhatwgURL(url: URL, fragment: boolean, unicode: boolean, search: boolean, auth: boolean) {
  // With everything kept, the serialization is exactly the href.
  if (fragment && !unicode && search && auth) return url.href;
  let ret = url.protocol;
  // file:/// and foo:// have an empty-but-present host; the href carries
  // the authority marker the components can't express.
  if (url.href.startsWith(ret + "//")) {
    ret += "//";
    const hasUsername = url.username !== "";
    const hasPassword = url.password !== "";
    if (auth && (hasUsername || hasPassword)) {
      if (hasUsername) ret += url.username;
      if (hasPassword) ret += ":" + url.password;
      ret += "@";
    }
    // On ToUnicode failure ada keeps the host as-is; never erase it.
    ret += unicode ? domainToUnicode(url.hostname) || url.hostname : url.hostname;
    const { port } = url;
    if (port !== "") ret += ":" + port;
  }
  ret += url.pathname;
  if (search) ret += url.search;
  if (fragment) ret += url.hash;
  return ret;
}

Url.prototype.format = function format() {
  var auth: string = this.auth || "";
  if (auth) {
    auth = encodeStr(auth, noEscapeAuth, hexTable);
    auth += "@";
  }

  var protocol: string = this.protocol || "",
    pathname: string = this.pathname || "",
    hash: string = this.hash || "",
    host = "",
    query = "";

  if (protocol && protocol.substr(-1) !== ":") {
    protocol += ":";
  }

  const thisHost = this.host;
  let thisHostname;
  if (thisHost) {
    host = auth + thisHost;
  } else if ((thisHostname = this.hostname)) {
    host =
      auth + (thisHostname.includes(":") && !isIpv6Hostname(thisHostname) ? "[" + thisHostname + "]" : thisHostname);
    const thisPort = this.port;
    if (thisPort) {
      host += ":" + thisPort;
    }
  }

  const thisQuery = this.query;
  if (thisQuery && typeof thisQuery === "object" && Object.keys(thisQuery).length) {
    query = new URLSearchParams(thisQuery).toString();
  }

  var search = this.search || (query && "?" + query) || "";

  /*
   * only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
   * unless they had them to begin with.
   */
  const { slashes } = this;
  if (slashes || slashedProtocol[protocol]) {
    if (slashes || host) {
      if (pathname && pathname.charAt(0) !== "/") {
        pathname = "/" + pathname;
      }
      host = "//" + host;
    } else if (protocol.startsWith("file")) {
      // Node special-cases hostless file: URLs to keep the // marker.
      host = "//";
    }
  }

  if (hash && hash.charAt(0) !== "#") {
    hash = "#" + hash;
  }
  if (search && search.charAt(0) !== "?") {
    search = "?" + search;
  }

  pathname = pathname.replace(/[?#]/g, function (match) {
    return encodeURIComponent(match);
  });
  search = search.replace(/#/g, "%23");

  return protocol + host + pathname + search + hash;
};

function urlResolve(source: string | URL | Url, relative: string | URL | Url) {
  return urlParse(source, false, true).resolve(relative);
}

Url.prototype.resolve = function resolve(relative: string | URL | Url) {
  return this.resolveObject(urlParse(relative, false, true)).format();
};

function urlResolveObject(source, relative) {
  if (!source) {
    return relative;
  }
  return urlParse(source, false, true).resolveObject(relative);
}

Url.prototype.resolveObject = function resolveObject(relative) {
  if (typeof relative === "string") {
    var rel = new Url();
    rel.parse(relative, false, true);
    relative = rel;
  }

  var result = new Url();
  var tkeys = Object.keys(this);
  for (var tk = 0; tk < tkeys.length; tk++) {
    var tkey = tkeys[tk];
    result[tkey] = this[tkey];
  }

  /*
   * hash is always overridden, no matter what.
   * even href="" will remove it.
   */
  result.hash = relative.hash;

  // if the relative url is empty, then there's nothing left to do here.
  if (relative.href === "") {
    result.href = result.format();
    return result;
  }

  // hrefs like //foo/bar always cut to the protocol.
  if (relative.slashes && !relative.protocol) {
    // take everything except the protocol from relative
    var rkeys = Object.keys(relative);
    for (var rk = 0; rk < rkeys.length; rk++) {
      var rkey = rkeys[rk];
      if (rkey !== "protocol") {
        result[rkey] = relative[rkey];
      }
    }

    // urlParse appends trailing / to urls like http://www.example.com
    if (slashedProtocol[result.protocol] && result.hostname && !result.pathname) {
      result.pathname = "/";
      result.path = result.pathname;
    }

    result.href = result.format();
    return result;
  }

  const relativeProtocol = relative.protocol;
  if (relativeProtocol && relativeProtocol !== result.protocol) {
    /*
     * if it's a known url protocol, then changing
     * the protocol does weird things
     * first, if it's not file:, then we MUST have a host,
     * and if there was a path
     * to begin with, then we MUST have a path.
     * if it is file:, then the host is dropped,
     * because that's known to be hostless.
     * anything else is assumed to be absolute.
     */
    if (!slashedProtocol[relativeProtocol]) {
      var keys = Object.keys(relative);
      for (var v = 0; v < keys.length; v++) {
        var k = keys[v];
        result[k] = relative[k];
      }
      result.href = result.format();
      return result;
    }

    result.protocol = relativeProtocol;
    if (
      !relative.host &&
      !(relativeProtocol === "file" || relativeProtocol === "file:") &&
      !hostlessProtocol[relativeProtocol]
    ) {
      let relPath = (relative.pathname || "").split("/");
      while (relPath.length && !(relative.host = relPath.shift())) {}
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
    // to support http.request
    const resultPathname = result.pathname;
    let resultSearch;
    if (resultPathname || (resultSearch = result.search)) {
      result.path = (resultPathname || "") + ((resultSearch ?? result.search) || "");
    }
    result.slashes = result.slashes || relative.slashes;
    result.href = result.format();
    return result;
  }

  const isSourceAbs = result.pathname && result.pathname.charAt(0) === "/";
  const isRelAbs = relative.host || (relative.pathname && relative.pathname.charAt(0) === "/");
  let mustEndAbs = isRelAbs || isSourceAbs || (result.host && relative.pathname);
  const removeAllDots = mustEndAbs;
  let srcPath = (result.pathname && result.pathname.split("/")) || [];
  const relPath = (relative.pathname && relative.pathname.split("/")) || [];
  const psychotic = result.protocol && !slashedProtocol[result.protocol];

  /*
   * if the url is a non-slashed url, then relative
   * links like ../.. should be able
   * to crawl up to the hostname, as well.  This is strange.
   * result.protocol has already been set by now.
   * Later on, put the first path part into the host field.
   */
  if (psychotic) {
    result.hostname = "";
    result.port = null;
    const resultHost = result.host;
    if (resultHost) {
      if (srcPath[0] === "") srcPath[0] = resultHost;
      else srcPath.unshift(resultHost);
    }
    result.host = "";
    if (relative.protocol) {
      relative.hostname = null;
      relative.port = null;
      result.auth = null;
      const relativeHost = relative.host;
      if (relativeHost) {
        if (relPath[0] === "") {
          relPath[0] = relativeHost;
        } else {
          relPath.unshift(relativeHost);
        }
      }
      relative.host = null;
    }
    mustEndAbs &&= relPath[0] === "" || srcPath[0] === "";
  }

  if (isRelAbs) {
    // it's absolute.
    const relativeHost = relative.host;
    if (relativeHost || relativeHost === "") {
      if (result.host !== relativeHost) result.auth = null;
      result.host = relativeHost;
      result.port = relative.port;
    }
    const relativeHostname = relative.hostname;
    if (relativeHostname || relativeHostname === "") {
      if (result.hostname !== relativeHostname) result.auth = null;
      result.hostname = relativeHostname;
    }
    result.search = relative.search;
    result.query = relative.query;
    srcPath = relPath;
    // fall through to the dot-handling below.
  } else if (relPath.length) {
    /*
     * it's relative
     * throw away the existing file, and take the new path instead.
     */
    srcPath ||= [];
    srcPath.pop();
    srcPath = srcPath.concat(relPath);
    result.search = relative.search;
    result.query = relative.query;
  } else {
    const relativeSearch = relative.search;
    if (relativeSearch != null && relativeSearch !== undefined) {
      /*
       * just pull out the search.
       * like href='?foo'.
       * Put this after the other two cases because it simplifies the booleans
       */
      if (psychotic) {
        result.hostname = result.host = srcPath.shift();
        /*
         * occationaly the auth can get stuck only in host
         * this especially happens in cases like
         * url.resolveObject('mailto:local1@domain1', 'local2@domain2')
         */
        var authInHost = result.host && result.host.indexOf("@") > 0 ? result.host.split("@") : false;
        if (authInHost) {
          result.auth = authInHost.shift();
          result.hostname = result.host = authInHost.shift();
        }
      }
      result.search = relativeSearch;
      result.query = relative.query;
      // to support http.request
      const resultPathname = result.pathname;
      const resultSearch = result.search;
      if (resultPathname !== null || resultSearch !== null) {
        result.path =
          (resultPathname ? resultPathname : "") + // force line break
          (resultSearch ? resultSearch : "");
      }
      result.href = result.format();
      return result;
    }
  }

  if (!srcPath.length) {
    /*
     * no path at all.  easy.
     * we've already handled the other stuff above.
     */
    result.pathname = null;
    // to support http.request
    const resultSearch = result.search;
    if (resultSearch) {
      result.path = "/" + resultSearch;
    } else {
      result.path = null;
    }
    result.href = result.format();
    return result;
  }

  /*
   * if a url ENDs in . or .., then it must get a trailing slash.
   * however, if it ends in anything else non-slashy,
   * then it must NOT get a trailing slash.
   */
  var last = srcPath.slice(-1)[0];
  // prettier-ignore
  var hasTrailingSlash = (
    ((result.host || relative.host || srcPath.length > 1) &&
    (last === "." || last === "..")) || last === "");

  /*
   * strip single dots, resolve double dots to parent dir
   * if the path tries to go above the root, `up` ends up > 0
   */
  var up = 0;
  for (var i = srcPath.length; i >= 0; i--) {
    last = srcPath[i];
    if (last === ".") {
      srcPath.splice(i, 1);
    } else if (last === "..") {
      srcPath.splice(i, 1);
      up++;
    } else if (up) {
      srcPath.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (!mustEndAbs && !removeAllDots) {
    for (; up--; up) {
      srcPath.unshift("..");
    }
  }

  if (mustEndAbs && srcPath[0] !== "" && (!srcPath[0] || srcPath[0].charAt(0) !== "/")) {
    srcPath.unshift("");
  }

  if (hasTrailingSlash && srcPath.join("/").substr(-1) !== "/") {
    srcPath.push("");
  }

  var isAbsolute = srcPath[0] === "" || (srcPath[0] && srcPath[0].charAt(0) === "/");

  // put the host back
  if (psychotic) {
    result.hostname = isAbsolute ? "" : srcPath.length ? srcPath.shift() : "";
    result.host = result.hostname;
    /*
     * occationaly the auth can get stuck only in host
     * this especially happens in cases like
     * url.resolveObject('mailto:local1@domain1', 'local2@domain2')
     */
    var authInHost = result.host && result.host.indexOf("@") > 0 ? result.host.split("@") : false;
    if (authInHost) {
      result.auth = authInHost.shift();
      result.hostname = result.host = authInHost.shift();
    }
  }

  mustEndAbs ||= result.host && srcPath.length;

  if (mustEndAbs && !isAbsolute) {
    srcPath.unshift("");
  }

  if (srcPath.length > 0) {
    result.pathname = srcPath.join("/");
  } else {
    result.pathname = null;
    result.path = null;
  }

  // to support request.http
  const resultPathname = result.pathname;
  let resultSearch;
  if (resultPathname !== null || (resultSearch = result.search) !== null) {
    resultSearch ??= result.search;
    // prettier-ignore
    result.path = (resultPathname ? resultPathname : "") +
                  (resultSearch   ? resultSearch   : "");
  }
  result.auth = relative.auth || result.auth;
  result.slashes = result.slashes || relative.slashes;
  result.href = result.format();
  return result;
};

Url.prototype.parseHost = function parseHost() {
  var host = this.host;
  var port = portPattern.exec(host);
  if (port) {
    port = port[0];
    if (port !== ":") {
      this.port = port.slice(1);
    }
    host = host.slice(0, host.length - port.length);
  }
  if (host) this.hostname = host;
};

// function fileURLToPath(...args) {
//   // Since we use WTF::URL::fileSystemPath directly in Bun.fileURLToPath, we don't get invalid windows
//   // path checking. We patch this in to `node:url` for compatibility. Note that
//   // this behavior is missing from WATWG URL.
//   if (process.platform === "win32") {
//     var url: string;
//     if ($isObject(args[0]) && args[0] instanceof Url) {
//       url = (args[0] as { href: string }).href;
//     } else if (typeof args[0] === "string") {
//       url = args[0];
//     } else {
//       throw $ERR_INVALID_ARG_TYPE("url", ["string", "URL"], args[0]);
//     }

//     for (var i = 0; i < url.length; i++) {
//       if (url.charCodeAt(i) === Char.PERCENT && (i + 1) < url.length) {
//         switch (url.charCodeAt(i + 1)) {
//         break;
//       }
//     }
//   }
//   return Bun.fileURLToPath.$call(args);
// }

/**
 * Add new characters as needed from
 * [here](https://github.com/nodejs/node/blob/main/lib/internal/constants.js).
 *
 * @note Do not move to another file, otherwise const enums will be imported as an object
 *      instead of being inlined.
 */
// prettier-ignore
const enum Char {
  // non-alphabetic characters
  AT = 64,                   // @
  COLON = 58,                // :
  BACKWARD_SLASH = 92,       // \
  FORWARD_SLASH = 47,        // /
  HASH = 35,                 // #
  QUESTION_MARK = 63,        // ?
  PERCENT = 37,              // %
  LEFT_SQUARE_BRACKET = 91,  // [
  RIGHT_SQUARE_BRACKET = 93, // ]
  DOUBLE_QUOTE = 34,         // "
  SINGLE_QUOTE = 39,         // '
  SEMICOLON = 59,            // ;
  LEFT_ANGLE_BRACKET = 60,   // <
  RIGHT_ANGLE_BRACKET = 62,  // >
  CIRCUMFLEX_ACCENT = 94,    // ^
  GRAVE_ACCENT = 96,         // `
  LEFT_CURLY_BRACKET = 123,  // {
  VERTICAL_LINE = 124,       // |
  RIGHT_CURLY_BRACKET = 125, // }

  // whitespace
  TAB = 9,                          // \t
  LINE_FEED = 10,                   // \n
  CARRIAGE_RETURN = 13,             // \r
  SPACE = 32,                       // ' '
  NO_BREAK_SPACE = 160,             //
  ZERO_WIDTH_NOBREAK_SPACE = 65279, //
}

const path = require("node:path");
const isWindows = process.platform === "win32";

// Mirrors the pre-encode table in node's src/node_url.cc EncodePathChars();
// the URL parser then applies the WHATWG path percent-encode set to the rest.
const encodePathCharsRe = /[\0\t\n\r "#%?[\\\]^|~]/g;
const encodePathCharsMap = {
  __proto__: null,
  "\0": "%00",
  "\t": "%09",
  "\n": "%0A",
  "\r": "%0D",
  " ": "%20",
  '"': "%22",
  "#": "%23",
  "%": "%25",
  "?": "%3F",
  "[": "%5B",
  "\\": "%5C",
  "]": "%5D",
  "^": "%5E",
  "|": "%7C",
  "~": "%7E",
};

function encodeWindowsPathChar(ch: string) {
  return ch === "\\" ? "/" : encodePathCharsMap[ch];
}
function encodePosixPathChar(ch: string) {
  return encodePathCharsMap[ch];
}

// Equivalent of node's bindingUrl.pathToFileURL (src/node_url.cc).
function createFileURL(filepath: string, windows: boolean, hostname?: string) {
  let outURL: URL;
  try {
    outURL = new URL(
      "file://" + filepath.replace(encodePathCharsRe, windows ? encodeWindowsPathChar : encodePosixPathChar),
    );
  } catch {
    throw $ERR_INVALID_URL(filepath);
  }
  if (hostname !== undefined) {
    // The WHATWG hostname setter is silent on failure; node throws when ada's
    // set_hostname() fails. Probe with the parser, which does throw.
    try {
      new URL("file://" + hostname + "/");
    } catch {
      throw $ERR_INVALID_URL(filepath, hostname);
    }
    outURL.hostname = hostname;
  }
  return outURL;
}

function pathToFileURL(filepath: string, options?: { windows?: boolean } | null) {
  validateString(filepath, "path");
  const windows = options?.windows ?? isWindows;
  const isUNC = windows && filepath.startsWith("\\\\");
  let resolved = isUNC ? filepath : windows ? path.win32.resolve(filepath) : path.posix.resolve(filepath);
  if (isUNC || (windows && resolved.startsWith("\\\\"))) {
    // UNC path format: \\server\share\resource
    // "\\?\UNC\" extended UNC path prefix is ignored.
    const isExtendedUNC = resolved.startsWith("\\\\?\\UNC\\");
    const prefixLength = isExtendedUNC ? 8 : 2;
    const hostnameEndIndex = resolved.indexOf("\\", prefixLength);
    if (hostnameEndIndex === -1) {
      throw $ERR_INVALID_ARG_VALUE("path", resolved, "Missing UNC resource path");
    }
    if (hostnameEndIndex === 2) {
      throw $ERR_INVALID_ARG_VALUE("path", resolved, "Empty UNC servername");
    }
    const hostname = resolved.slice(prefixLength, hostnameEndIndex);
    return createFileURL(resolved.slice(hostnameEndIndex), true, hostname);
  }
  // path.resolve strips trailing slashes so we must add them back
  const filePathLast = filepath.charCodeAt(filepath.length - 1);
  if (
    (filePathLast === Char.FORWARD_SLASH || (windows && filePathLast === Char.BACKWARD_SLASH)) &&
    resolved[resolved.length - 1] !== path.sep
  ) {
    resolved += "/";
  }
  return createFileURL(resolved, windows);
}

function fileURLToPath(url: string | URL) {
  try {
    return Bun.fileURLToPath(url as any);
  } catch (err: any) {
    // node attaches the parsed URL as err.input on this code (lib/internal/errors.js).
    if (err?.code === "ERR_INVALID_FILE_URL_PATH") {
      err.input = typeof url === "string" ? new URL(url) : url;
    }
    throw err;
  }
}

export default {
  parse: urlParse,
  resolve: urlResolve,
  resolveObject: urlResolveObject,
  format: urlFormat,
  Url,
  URLSearchParams,
  URL,
  URLPattern,
  pathToFileURL,
  fileURLToPath,
  urlToHttpOptions,
  domainToASCII,
  domainToUnicode,
};
