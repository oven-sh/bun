// A bundle holds one library twice: classes of the same names and fields. Objects of one copy, and others, are passed to functions of the other.
"use strict";
const out = [];
const modules = {
  first(module) {
    var Scope = function Scope(flags) { this.flags = flags; this.var = []; this.lexical = []; this.functions = []; };
    var Token = function Token(type, value, start, end) { this.type = type; this.value = value; this.start = start; this.end = end; };
    class Span { constructor(from, to) { this.from = from; this.to = to; this.label = "@"; } get size() { return this.to - this.from; } }
    var Reader = function Reader(text) { this.text = text; this.stack = []; this.seen = 0; };
    var reads = Reader.prototype;
    reads.enter = function (flags) { this.stack.push(new Scope(flags)); return this; };
    reads.current = function () { for (var i = this.stack.length - 1; ; i--) { var scope = this.stack[i]; if (!scope || scope.flags & 2) return scope; } };
    reads.declare = function (name, scope) { scope = scope || this.current(); var known = scope.lexical.indexOf(name) > -1 || scope.functions.indexOf(name) > -1 || scope.var.indexOf(name) > -1; if (scope.flags & 1) scope.functions.push(name); else scope.var.push(name); this.seen += scope.lexical.length; return known + ":" + scope.var.length + scope.functions.length; };
    reads.describe = function (token) { return token.type + token.value + token.start + "-" + token.end; };
    reads.widen = function (span) { span.from--; span.to++; return span.label + span.size + span.from; };
    reads.all = function (tokens) { var out = ""; for (var i = 0; i < tokens.length; i++) out += this.describe(tokens[i]) + (tokens[i].end - tokens[i].start); return out; };
    module.exports = { Scope: Scope, Token: Token, Span: Span, Reader: Reader };
  },
  second(module) {
    var Scope = function Scope(flags) { this.flags = flags; this.var = []; this.lexical = []; this.functions = []; };
    var Token = function Token(type, value, start, end) { this.type = type; this.value = value; this.start = start; this.end = end; };
    class Span { constructor(from, to) { this.from = from; this.to = to; this.label = "@"; } get size() { return this.to - this.from; } }
    var Reader = function Reader(text) { this.text = text; this.stack = []; this.seen = 0; };
    var reads = Reader.prototype;
    reads.enter = function (flags) { this.stack.push(new Scope(flags)); return this; };
    reads.current = function () { for (var i = this.stack.length - 1; ; i--) { var scope = this.stack[i]; if (!scope || scope.flags & 2) return scope; } };
    reads.declare = function (name, scope) { scope = scope || this.current(); var known = scope.lexical.indexOf(name) > -1 || scope.functions.indexOf(name) > -1 || scope.var.indexOf(name) > -1; if (scope.flags & 1) scope.functions.push(name); else scope.var.push(name); this.seen += scope.lexical.length; return known + ":" + scope.var.length + scope.functions.length; };
    reads.describe = function (token) { return token.type + token.value + token.start + "-" + token.end; };
    reads.widen = function (span) { span.from--; span.to++; return span.label + span.size + span.from; };
    reads.all = function (tokens) { var out = ""; for (var i = 0; i < tokens.length; i++) out += this.describe(tokens[i]) + (tokens[i].end - tokens[i].start); return out; };
    module.exports = { Scope: Scope, Token: Token, Span: Span, Reader: Reader };
  },
  third(module) {
    var Scope = function Scope(flags) { this.flags = flags; this.var = []; this.lexical = []; this.functions = []; this.extra = 1; };
    var Token = function Token(type, value, start, end) { this.type = type; this.start = start; this.end = end; };
    class Span { constructor(from, to) { this.from = from; this.to = to; this.label = "@"; } get size() { return this.to - this.from; } }
    var Reader = function Reader(text) { this.text = text; this.stack = []; this.seen = 0; };
    var reads = Reader.prototype;
    reads.enter = function (flags) { this.stack.push(new Scope(flags)); return this; };
    reads.current = function () { for (var i = this.stack.length - 1; ; i--) { var scope = this.stack[i]; if (!scope || scope.flags & 2) return scope; } };
    reads.declare = function (name, scope) { scope = scope || this.current(); var known = scope.lexical.indexOf(name) > -1 || scope.functions.indexOf(name) > -1 || scope.var.indexOf(name) > -1; if (scope.flags & 1) scope.functions.push(name); else scope.var.push(name); this.seen += scope.lexical.length; return known + ":" + scope.var.length + scope.functions.length; };
    reads.describe = function (token) { return token.type + token.value + token.start + "-" + token.end; };
    reads.widen = function (span) { span.from--; span.to++; return span.label + span.size + span.from; };
    reads.all = function (tokens) { var out = ""; for (var i = 0; i < tokens.length; i++) out += this.describe(tokens[i]) + (tokens[i].end - tokens[i].start); return out; };
    module.exports = { Scope: Scope, Token: Token, Span: Span, Reader: Reader };
  },
};
const load = (name) => { const module = { exports: {} }; modules[name](module); return module.exports; };
const copies = [load("first"), load("second"), load("third"), load("first")];
globalThis[process.argv[7] || "copies"] = copies;
const run = (work) => { try { return String(work()); } catch (error) { return error.constructor.name; } };
const strange = [() => null, () => undefined, () => 3, () => "text", () => ({}), () => ({ flags: 3, var: [1], lexical: ["a"], functions: [], type: "t", value: 1, start: 2, end: 9, from: 1, to: 5, label: "l", size: 7 }), () => [1, 2], () => new Map(), () => function named() {}];
for (const a of copies) for (const b of copies) {
  const reader = new a.Reader("text").enter(2).enter(1).enter(3);
  out.push(run(() => reader.declare("a") + reader.declare("a") + reader.declare("b", new b.Scope(0)) + reader.declare("b", new b.Scope(3))));
  const tokens = [new a.Token("x", "v", 1, 3), new b.Token("y", "w", 4, 9), new b.Token("z", 5, 0.5, 2)];
  out.push(run(() => reader.all(tokens)), run(() => reader.widen(new b.Span(1, 5)) + reader.widen(new a.Span(0, 1))));
  for (const make of strange) out.push(run(() => reader.declare("s", make())), run(() => reader.describe(make())), run(() => reader.widen(make())), run(() => reader.all([make(), tokens[0], make()])));
  const made = [() => Object.freeze(new b.Scope(1)), () => { const s = new b.Scope(1); delete s.functions; return s; }, () => Object.create(new b.Scope(2)), () => new Proxy(new b.Scope(3), {}), () => Object.defineProperty(new b.Scope(0), "flags", { get() { out.push("flags"); return 1; } }), () => new (class extends b.Scope { get late() { return 1; } })(1), () => { const s = new b.Scope(1); s.flags = { valueOf() { return 1; } }; s.var = "text"; return s; }];
  for (const make of made) { reader.stack.push(make()); out.push(run(() => reader.declare("m")), run(() => reader.current() === reader.stack[reader.stack.length - 1]), run(() => reader.declare("n", make()))); reader.stack.pop(); }
}
copies[0].Scope.prototype.flags = 2; out.push(run(() => { const r = new copies[1].Reader("q"); const s = new copies[0].Scope(0); delete s.flags; r.stack.push(s); return r.current() === s; }));
for (const line of out) console.log(line);
