// reading characters: past the end, pairs of surrogates, code points, cursors that go both ways, unicode expressions
'use strict';
function Cursor(text) { this.text = text; this.pos = 0; this.line = 1; }
Cursor.prototype.peek = function (n) { return this.text[this.pos + (n || 0)]; };
Cursor.prototype.code = function (n) { return this.text.charCodeAt(this.pos + (n || 0)); };
Cursor.prototype.next = function () { var c = this.text.codePointAt(this.pos); if (c === undefined) return undefined; this.pos += c > 0xffff ? 2 : 1; if (c === 10) this.line++; return c; };
Cursor.prototype.back = function () { if (this.pos <= 0) return undefined; this.pos--; var c = this.code(); if (c >= 0xdc00 && c <= 0xdfff && this.pos > 0) { var h = this.code(-1); if (h >= 0xd800 && h <= 0xdbff) { this.pos--; c = (h - 0xd800) * 0x400 + c - 0xdc00 + 0x10000; } } return c; };
Cursor.prototype.until = function (test) { var s = this.pos; while (this.peek() !== undefined && !test(this.peek(), this.code())) this.pos++; return this.text.slice(s, this.pos); };
Cursor.prototype.number = function () { var n = 0, any = false; for (var c = this.code(); c >= 48 && c <= 57; c = this.code(++any && 0)) { n = n * 10 + c - 48; this.pos++; } return any || n ? n : NaN; };
function same(a, b) { for (var i = 0; i <= Math.max(a.length, b.length); i++) { if (a.charAt(i) !== b.charAt(i)) return i; } return -1; }
function reverse(s) { var out = ''; for (var i = s.length; i >= 0; i--) { var c = s[i]; if (c === undefined) continue; if (c >= '\udc00' && c <= '\udfff' && i > 0 && s[i - 1] >= '\ud800') { out += s[i - 1] + c; i--; } else out += c; } return out; }
function ends(s) { return [s.at(-1), s.at(0), s.at(s.length), s[-1], s[1.5], s['1'], s.charAt(-1) === '', s.charCodeAt(NaN), s.codePointAt(s.length - 1), s[s.length]].map(String).join(); }
function classes(s) { var out = { letter: 0, upper: 0, digit: 0, space: 0, emoji: 0, other: 0 }; for (var c of s) { if (/\p{Lu}/u.test(c)) out.upper++; if (/\p{L}/u.test(c)) out.letter++; else if (/\p{Nd}/u.test(c)) out.digit++; else if (/\s/u.test(c)) out.space++; else if (/\p{Emoji_Presentation}/u.test(c)) out.emoji++; else out.other++; } return out; }
module.exports = { Cursor: Cursor, same: same, reverse: reverse, ends: ends, classes: classes };
