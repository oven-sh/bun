var it = function(s) {
  return typeof s == "string";
}, D = function(s) {
  return typeof s == "object" && s !== null;
}, I = function(s) {
  return s === null;
}, E = function(s) {
  return s == null;
};
var m = function() {
  this.protocol = null, this.slashes = null, this.auth = null, this.host = null, this.port = null, this.hostname = null, this.hash = null, this.search = null, this.query = null, this.pathname = null, this.path = null, this.href = null;
}, A = function(s, r, t) {
  if (s && D(s) && s instanceof m)
    return s;
  var o = new m;
  return o.parse(s, r, t), o;
}, V = function(s) {
  return it(s) && (s = A(s)), s instanceof m ? s.format() : m.prototype.format.call(s);
}, W = function(s, r) {
  return A(s, !1, !0).resolve(r);
}, X = function(s, r) {
  return s ? A(s, !1, !0).resolveObject(r) : r;
}, { URL: F, URLSearchParams: M, [Symbol.for("Bun.lazy")]: S } = globalThis, tt = /^([a-z0-9.+-]+:)/i, st = /:[0-9]*$/, ht = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/, et = [
  "<",
  ">",
  '"',
  "`",
  " ",
  "\r",
  `
`,
  "	"
], rt = ["{", "}", "|", "\\", "^", "`"].concat(et), B = ["'"].concat(rt), G = ["%", "/", "?", ";", "#"].concat(B), J = ["/", "?", "#"], ot = 255, K = /^[+a-z0-9A-Z_-]{0,63}$/, at = /^([+a-z0-9A-Z_-]{0,63})(.*)$/, nt = { javascript: !0, "javascript:": !0 }, N = { javascript: !0, "javascript:": !0 }, R = {
  http: !0,
  https: !0,
  ftp: !0,
  gopher: !0,
  file: !0,
  "http:": !0,
  "https:": !0,
  "ftp:": !0,
  "gopher:": !0,
  "file:": !0
}, Z = {
  parse(s) {
    var r = decodeURIComponent;
    return (s + "").replace(/\+/g, " ").split("&").filter(Boolean).reduce(function(t, o, a) {
      var l = o.split("="), f = r(l[0] || ""), h = r(l[1] || ""), g = t[f];
      return t[f] = g === void 0 ? h : [].concat(g, h), t;
    }, {});
  },
  stringify(s) {
    var r = encodeURIComponent;
    return Object.keys(s || {}).reduce(function(t, o) {
      return [].concat(s[o]).forEach(function(a) {
        t.push(r(o) + "=" + r(a));
      }), t;
    }, []).join("&").replace(/\s/g, "+");
  }
};
m.prototype.parse = function(s, r, t) {
  if (!it(s))
    throw new TypeError("Parameter 'url' must be a string, not " + typeof s);
  var o = s.indexOf("?"), a = o !== -1 && o < s.indexOf("#") ? "?" : "#", l = s.split(a), f = /\\/g;
  l[0] = l[0].replace(f, "/"), s = l.join(a);
  var h = s;
  if (h = h.trim(), !t && s.split("#").length === 1) {
    var g = ht.exec(h);
    if (g)
      return this.path = h, this.href = h, this.pathname = g[1], g[2] ? (this.search = g[2], r ? this.query = Z.parse(this.search.substr(1)) : this.query = this.search.substr(1)) : r && (this.search = "", this.query = {}), this;
  }
  var c = tt.exec(h);
  if (c) {
    c = c[0];
    var v = c.toLowerCase();
    this.protocol = v, h = h.substr(c.length);
  }
  if (t || c || h.match(/^\/\/[^@\/]+@[^@\/]+/)) {
    var j = h.substr(0, 2) === "//";
    j && !(c && N[c]) && (h = h.substr(2), this.slashes = !0);
  }
  if (!N[c] && (j || c && !R[c])) {
    for (var u = -1, n = 0;n < J.length; n++) {
      var b = h.indexOf(J[n]);
      b !== -1 && (u === -1 || b < u) && (u = b);
    }
    var P, p;
    u === -1 ? p = h.lastIndexOf("@") : p = h.lastIndexOf("@", u), p !== -1 && (P = h.slice(0, p), h = h.slice(p + 1), this.auth = decodeURIComponent(P)), u = -1;
    for (var n = 0;n < G.length; n++) {
      var b = h.indexOf(G[n]);
      b !== -1 && (u === -1 || b < u) && (u = b);
    }
    u === -1 && (u = h.length), this.host = h.slice(0, u), h = h.slice(u), this.parseHost(), this.hostname = this.hostname || "";
    var C = this.hostname[0] === "[" && this.hostname[this.hostname.length - 1] === "]";
    if (!C)
      for (var e = this.hostname.split(/\./), n = 0, i = e.length;n < i; n++) {
        var d = e[n];
        if (!!d && !d.match(K)) {
          for (var y = "", x = 0, _ = d.length;x < _; x++)
            d.charCodeAt(x) > 127 ? y += "x" : y += d[x];
          if (!y.match(K)) {
            var q = e.slice(0, n), O = e.slice(n + 1), U = d.match(at);
            U && (q.push(U[1]), O.unshift(U[2])), O.length && (h = "/" + O.join(".") + h), this.hostname = q.join(".");
            break;
          }
        }
      }
    this.hostname.length > ot ? this.hostname = "" : this.hostname = this.hostname.toLowerCase(), C || (this.hostname = new F(`https://${this.hostname}`).hostname);
    var w = this.port ? ":" + this.port : "", H = this.hostname || "";
    this.host = H + w, this.href += this.host, C && (this.hostname = this.hostname.substr(1, this.hostname.length - 2), h[0] !== "/" && (h = "/" + h));
  }
  if (!nt[v])
    for (var n = 0, i = B.length;n < i; n++) {
      var L = B[n];
      if (h.indexOf(L) !== -1) {
        var z = encodeURIComponent(L);
        z === L && (z = escape(L)), h = h.split(L).join(z);
      }
    }
  var $ = h.indexOf("#");
  $ !== -1 && (this.hash = h.substr($), h = h.slice(0, $));
  var T = h.indexOf("?");
  if (T !== -1 ? (this.search = h.substr(T), this.query = h.substr(T + 1), r && (this.query = Z.parse(this.query)), h = h.slice(0, T)) : r && (this.search = "", this.query = {}), h && (this.pathname = h), R[v] && this.hostname && !this.pathname && (this.pathname = "/"), this.pathname || this.search) {
    var w = this.pathname || "", Q = this.search || "";
    this.path = w + Q;
  }
  return this.href = this.format(), this;
};
m.prototype.format = function() {
  var s = this.auth || "";
  s && (s = encodeURIComponent(s), s = s.replace(/%3A/i, ":"), s += "@");
  var r = this.protocol || "", t = this.pathname || "", o = this.hash || "", a = !1, l = "";
  this.host ? a = s + this.host : this.hostname && (a = s + (this.hostname.indexOf(":") === -1 ? this.hostname : "[" + this.hostname + "]"), this.port && (a += ":" + this.port)), this.query && D(this.query) && Object.keys(this.query).length && (l = Z.stringify(this.query));
  var f = this.search || l && "?" + l || "";
  return r && r.substr(-1) !== ":" && (r += ":"), this.slashes || (!r || R[r]) && a !== !1 ? (a = "//" + (a || ""), t && t.charAt(0) !== "/" && (t = "/" + t)) : a || (a = ""), o && o.charAt(0) !== "#" && (o = "#" + o), f && f.charAt(0) !== "?" && (f = "?" + f), t = t.replace(/[?#]/g, function(h) {
    return encodeURIComponent(h);
  }), f = f.replace("#", "%23"), r + a + t + f + o;
};
m.prototype.resolve = function(s) {
  return this.resolveObject(A(s, !1, !0)).format();
};
m.prototype.resolveObject = function(s) {
  if (it(s)) {
    var r = new m;
    r.parse(s, !1, !0), s = r;
  }
  for (var t = new m, o = Object.keys(this), a = 0;a < o.length; a++) {
    var l = o[a];
    t[l] = this[l];
  }
  if (t.hash = s.hash, s.href === "")
    return t.href = t.format(), t;
  if (s.slashes && !s.protocol) {
    for (var f = Object.keys(s), h = 0;h < f.length; h++) {
      var g = f[h];
      g !== "protocol" && (t[g] = s[g]);
    }
    return R[t.protocol] && t.hostname && !t.pathname && (t.path = t.pathname = "/"), t.href = t.format(), t;
  }
  if (s.protocol && s.protocol !== t.protocol) {
    if (!R[s.protocol]) {
      for (var c = Object.keys(s), v = 0;v < c.length; v++) {
        var j = c[v];
        t[j] = s[j];
      }
      return t.href = t.format(), t;
    }
    if (t.protocol = s.protocol, !s.host && !N[s.protocol]) {
      for (var i = (s.pathname || "").split("/");i.length && !(s.host = i.shift()); )
        ;
      s.host || (s.host = ""), s.hostname || (s.hostname = ""), i[0] !== "" && i.unshift(""), i.length < 2 && i.unshift(""), t.pathname = i.join("/");
    } else
      t.pathname = s.pathname;
    if (t.search = s.search, t.query = s.query, t.host = s.host || "", t.auth = s.auth, t.hostname = s.hostname || s.host, t.port = s.port, t.pathname || t.search) {
      var u = t.pathname || "", n = t.search || "";
      t.path = u + n;
    }
    return t.slashes = t.slashes || s.slashes, t.href = t.format(), t;
  }
  var b = t.pathname && t.pathname.charAt(0) === "/", P = s.host || s.pathname && s.pathname.charAt(0) === "/", p = P || b || t.host && s.pathname, C = p, e = t.pathname && t.pathname.split("/") || [], i = s.pathname && s.pathname.split("/") || [], d = t.protocol && !R[t.protocol];
  if (d && (t.hostname = "", t.port = null, t.host && (e[0] === "" ? e[0] = t.host : e.unshift(t.host)), t.host = "", s.protocol && (s.hostname = null, s.port = null, s.host && (i[0] === "" ? i[0] = s.host : i.unshift(s.host)), s.host = null), p = p && (i[0] === "" || e[0] === "")), P)
    t.host = s.host || s.host === "" ? s.host : t.host, t.hostname = s.hostname || s.hostname === "" ? s.hostname : t.hostname, t.search = s.search, t.query = s.query, e = i;
  else if (i.length)
    e || (e = []), e.pop(), e = e.concat(i), t.search = s.search, t.query = s.query;
  else if (!E(s.search)) {
    if (d) {
      t.hostname = t.host = e.shift();
      var y = t.host && t.host.indexOf("@") > 0 ? t.host.split("@") : !1;
      y && (t.auth = y.shift(), t.host = t.hostname = y.shift());
    }
    return t.search = s.search, t.query = s.query, (!I(t.pathname) || !I(t.search)) && (t.path = (t.pathname ? t.pathname : "") + (t.search ? t.search : "")), t.href = t.format(), t;
  }
  if (!e.length)
    return t.pathname = null, t.search ? t.path = "/" + t.search : t.path = null, t.href = t.format(), t;
  for (var x = e.slice(-1)[0], _ = (t.host || s.host || e.length > 1) && (x === "." || x === "..") || x === "", q = 0, O = e.length;O >= 0; O--)
    x = e[O], x === "." ? e.splice(O, 1) : x === ".." ? (e.splice(O, 1), q++) : q && (e.splice(O, 1), q--);
  if (!p && !C)
    for (;q--; q)
      e.unshift("..");
  p && e[0] !== "" && (!e[0] || e[0].charAt(0) !== "/") && e.unshift(""), _ && e.join("/").substr(-1) !== "/" && e.push("");
  var U = e[0] === "" || e[0] && e[0].charAt(0) === "/";
  if (d) {
    t.hostname = t.host = U ? "" : e.length ? e.shift() : "";
    var y = t.host && t.host.indexOf("@") > 0 ? t.host.split("@") : !1;
    y && (t.auth = y.shift(), t.host = t.hostname = y.shift());
  }
  return p = p || t.host && e.length, p && !U && e.unshift(""), e.length ? t.pathname = e.join("/") : (t.pathname = null, t.path = null), (!I(t.pathname) || !I(t.search)) && (t.path = (t.pathname ? t.pathname : "") + (t.search ? t.search : "")), t.auth = s.auth || t.auth, t.slashes = t.slashes || s.slashes, t.href = t.format(), t;
}, m.prototype.parseHost = function() {
  var s = this.host, r = st.exec(s);
  r && (r = r[0], r !== ":" && (this.port = r.substr(1)), s = s.substr(0, s.length - r.length)), s && (this.hostname = s);
};
var Y, k;
S && (Y = S("pathToFileURL"), k = S("fileURLToPath"));
var ut = {
  parse: A,
  resolve: W,
  resolveObject: X,
  format: V,
  Url: m,
  pathToFileURL: Y,
  fileURLToPath: k,
  URL: F,
  URLSearchParams: M
};
export {
  X as resolveObject,
  W as resolve,
  Y as pathToFileURL,
  A as parse,
  V as format,
  k as fileURLToPath,
  ut as default,
  m as Url,
  M as URLSearchParams,
  F as URL
};
