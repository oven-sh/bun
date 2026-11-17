// a recursive reader with positions, comments allowed, reviver; and a writer with indents and cycles
'use strict';
function Reader(text, options) { this.t = text; this.i = 0; this.o = options || {}; this.depth = 0; }
Reader.prototype.fail = function (m) { var line = 1, col = 1; for (var k = 0; k < this.i; k++) if (this.t[k] === '\n') { line++; col = 1; } else col++; var e = new SyntaxError(m + ' at ' + line + ':' + col); e.line = line; throw e; };
Reader.prototype.ws = function () {
  for (;;) {
    var c = this.t.charCodeAt(this.i);
    if (c === 32 || c === 10 || c === 13 || c === 9) { this.i++; continue; }
    if (this.o.comments && c === 47) {
      var n = this.t.charCodeAt(this.i + 1);
      if (n === 47) { while (this.i < this.t.length && this.t.charCodeAt(this.i) !== 10) this.i++; continue; }
      if (n === 42) { var e = this.t.indexOf('*/', this.i); if (e < 0) this.fail('open comment'); this.i = e + 2; continue; }
    }
    return;
  }
};
Reader.prototype.value = function () {
  this.ws();
  var c = this.t[this.i];
  switch (c) {
    case '{': return this.object();
    case '[': return this.array();
    case '"': return this.string();
    case 't': return this.word('true', true);
    case 'f': return this.word('false', false);
    case 'n': return this.word('null', null);
    case undefined: return this.fail('end of text');
    default: if (c === '-' || c >= '0' && c <= '9') return this.number(); return this.fail('unexpected ' + c);
  }
};
Reader.prototype.word = function (w, v) { if (this.t.substr(this.i, w.length) !== w) this.fail('bad word'); this.i += w.length; return v; };
Reader.prototype.number = function () { var re = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y; re.lastIndex = this.i; var m = re.exec(this.t); if (!m) this.fail('bad number'); this.i += m[0].length; if (this.o.big && /^-?\d{16,}$/.test(m[0])) return BigInt(m[0]); return +m[0]; };
Reader.prototype.string = function () {
  var out = '', s = ++this.i;
  for (;;) {
    var c = this.t[this.i];
    if (c === undefined) this.fail('open string');
    if (c === '"') { out += this.t.slice(s, this.i++); return out; }
    if (c === '\\') {
      out += this.t.slice(s, this.i);
      var e = this.t[++this.i], k = 'bfnrt"\\/'.indexOf(e);
      if (k >= 0) out += '\b\f\n\r\t"\\/'[k];
      else if (e === 'u') { var h = this.t.substr(this.i + 1, 4); if (!/^[0-9a-fA-F]{4}$/.test(h)) this.fail('bad escape'); out += String.fromCharCode(parseInt(h, 16)); this.i += 4; }
      else this.fail('bad escape');
      s = ++this.i;
      continue;
    }
    if (c < ' ') this.fail('control');
    this.i++;
  }
};
Reader.prototype.array = function () {
  var a = [];
  this.i++;
  if (++this.depth > 50) this.fail('too deep');
  this.ws();
  if (this.t[this.i] === ']') { this.i++; this.depth--; return a; }
  for (;;) {
    a.push(this.value());
    this.ws();
    var c = this.t[this.i++];
    if (c === ']') { this.depth--; return a; }
    if (c !== ',') { this.i--; this.fail('expected , or ]'); }
    if (this.o.trailing) { this.ws(); if (this.t[this.i] === ']') { this.i++; this.depth--; return a; } }
  }
};
Reader.prototype.object = function () {
  var o = {};
  this.i++; this.ws();
  if (this.t[this.i] === '}') { this.i++; return o; }
  for (;;) {
    this.ws();
    if (this.t[this.i] !== '"') this.fail('expected a key');
    var k = this.string();
    this.ws();
    if (this.t[this.i++] !== ':') { this.i--; this.fail('expected :'); }
    var v = this.value();
    if (this.o.reviver) v = this.o.reviver(k, v);
    if (v !== undefined) { if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true }); else o[k] = v; }
    this.ws();
    var c = this.t[this.i++];
    if (c === '}') return o;
    if (c !== ',') { this.i--; this.fail('expected , or }'); }
  }
};
function parse(t, o) { var r = new Reader(t, o), v = r.value(); r.ws(); if (r.i < t.length) r.fail('more text'); return v; }
function quote(s) {
  var out = '"', last = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i), e = null;
    if (c === 34) e = '\\"'; else if (c === 92) e = '\\\\'; else if (c === 10) e = '\\n'; else if (c === 9) e = '\\t'; else if (c < 32 || c >= 0xd800 && c <= 0xdfff) e = '\\u' + ('000' + c.toString(16)).slice(-4);
    if (e !== null) { out += s.slice(last, i) + e; last = i + 1; }
  }
  return out + s.slice(last) + '"';
}
function write(v, indent, seen, pad) {
  seen = seen || []; pad = pad || '';
  if (v === null) return 'null';
  switch (typeof v) { case 'string': return quote(v); case 'number': return isFinite(v) ? Object.is(v, -0) ? '0' : String(v) : 'null'; case 'boolean': return String(v); case 'bigint': return String(v); case 'undefined': case 'function': case 'symbol': return undefined; }
  if (typeof v.toJSON === 'function') return write(v.toJSON(), indent, seen, pad);
  var at = seen.indexOf(v);
  if (at >= 0) return quote('cycle ' + at);
  seen.push(v);
  var inner = pad + (indent || ''), nl = indent ? '\n' : '', parts = [], s;
  if (Array.isArray(v)) {
    for (var i = 0; i < v.length; i++) { s = write(v[i], indent, seen, inner); parts.push((s === undefined ? 'null' : s)); }
    s = parts.length ? '[' + nl + parts.map(function (p) { return (indent ? inner : '') + p; }).join(',' + nl) + nl + (indent ? pad : '') + ']' : '[]';
  } else {
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) { s = write(v[k], indent, seen, inner); if (s !== undefined) parts.push((indent ? inner : '') + quote(k) + (indent ? ': ' : ':') + s); }
    s = parts.length ? '{' + nl + parts.join(',' + nl) + nl + (indent ? pad : '') + '}' : '{}';
  }
  seen.pop();
  return s;
}
module.exports = { parse: parse, write: write };
