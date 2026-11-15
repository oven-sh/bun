// a hand-written scanner: positions, strings with escapes, numbers of every base, comments, operators by longest match
'use strict';
var OPS = ['>>>=', '===', '!==', '>>>', '<<=', '>>=', '**=', '...', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '<<', '>>', '**'];
var WORDS = { 'if': 1, 'else': 1, 'for': 1, 'while': 1, 'return': 1, 'function': 1, 'var': 1, 'let': 1, 'const': 1, 'new': 1, 'typeof': 1 };
function Lexer(input) { this.input = input; this.pos = 0; this.line = 1; this.start = 0; this.tokens = []; }
Lexer.prototype.error = function (m) { var e = new SyntaxError(m + ' at ' + this.line + ':' + (this.pos - this.start)); e.pos = this.pos; throw e; };
Lexer.prototype.push = function (type, value, at) { this.tokens.push({ type: type, value: value, line: this.line, column: at - this.start, index: at }); };
Lexer.prototype.run = function () {
  var s = this.input, n = s.length;
  while (this.pos < n) {
    var c = s.charCodeAt(this.pos), at = this.pos;
    if (c === 10) { this.line++; this.pos++; this.start = this.pos; continue; }
    if (c === 32 || c === 9 || c === 13) { this.pos++; continue; }
    if (c === 47 && s.charCodeAt(at + 1) === 47) { while (this.pos < n && s.charCodeAt(this.pos) !== 10) this.pos++; continue; }
    if (c === 47 && s.charCodeAt(at + 1) === 42) { var e = s.indexOf('*/', at + 2); if (e < 0) this.error('unfinished comment'); for (var k = at; k < e; k++) if (s.charCodeAt(k) === 10) { this.line++; this.start = k + 1; } this.pos = e + 2; continue; }
    if (c >= 48 && c <= 57 || c === 46 && isDigit(s.charCodeAt(at + 1))) { this.number(at); continue; }
    if (c >= 97 && c <= 122 || c >= 65 && c <= 90 || c === 95 || c === 36 || c > 127) { while (this.pos < n && isPart(s.charCodeAt(this.pos))) this.pos++; var w = s.slice(at, this.pos); this.push(Object.prototype.hasOwnProperty.call(WORDS, w) ? 'word' : 'name', w, at); continue; }
    if (c === 34 || c === 39) { this.string(c, at); continue; }
    this.operator(at);
  }
  return this.tokens;
};
function isDigit(c) { return c >= 48 && c <= 57; }
function isPart(c) { return c >= 97 && c <= 122 || c >= 65 && c <= 90 || c >= 48 && c <= 57 || c === 95 || c === 36 || c > 127; }
Lexer.prototype.number = function (at) {
  var m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d*(?:[eE][+-]?\d+)?)n?/.exec(this.input.slice(at, at + 40)), t = m[0];
  this.pos += t.length; var big = t.charAt(t.length - 1) === 'n', body = (big ? t.slice(0, -1) : t).replace(/_/g, '');
  this.push(big ? 'bigint' : 'number', big ? BigInt(body) : Number(body), at);
};
Lexer.prototype.string = function (q, at) {
  var out = '', s = this.input; this.pos++;
  for (;;) {
    if (this.pos >= s.length) this.error('unfinished string');
    var c = s.charCodeAt(this.pos++);
    if (c === q) break;
    if (c === 10) this.error('line break in a string');
    if (c !== 92) { out += String.fromCharCode(c); continue; }
    var e = s.charAt(this.pos++);
    switch (e) { case 'n': out += '\n'; break; case 't': out += '\t'; break; case 'u': { var h = s.substr(this.pos, 4); if (!/^[0-9a-f]{4}$/i.test(h)) this.error('bad escape'); out += String.fromCharCode(parseInt(h, 16)); this.pos += 4; break; } case 'x': out += String.fromCharCode(parseInt(s.substr(this.pos, 2), 16)); this.pos += 2; break; case '0': out += '\0'; break; default: out += e; }
  }
  this.push('string', out, at);
};
Lexer.prototype.operator = function (at) { for (var i = 0; i < OPS.length; i++) if (this.input.startsWith(OPS[i], at)) { this.pos += OPS[i].length; return this.push('op', OPS[i], at); } var c = this.input.charAt(at); if ('+-*/%=<>!&|^~?:;,.()[]{}'.indexOf(c) < 0) this.error('unexpected ' + JSON.stringify(c)); this.pos++; this.push('op', c, at); };
module.exports = function lex(t) { return new Lexer(t).run(); };
