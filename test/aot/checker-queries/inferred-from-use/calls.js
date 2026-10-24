// A callee is a function. An argument is what the parameter is written to be, or what the parameter is inferred to be.
// parameter `f` = Function
function run(f) { return f(); }
// parameter `C` = Function
function make(C) { return new C(); }
// parameter `f` = Function
function maybeRun(f) { return f?.(); }
// parameter `a` = any
// parameter `g` = Function
function forward(a, g) { return g(a); }
// predicted `a` = number
function floor(a) { return Math.floor(a); }
// parameter `s` = string
function parse(s) { return JSON.parse(s); }
// parameter `o` = { name?: any; }
function outer(o) { return inner(o); }
// parameter `o` = { name?: any; }
function inner(o) { return o.name; }
// parameter `o` = { box: { name?: any; }; }
function passesMember(o) { o.box.name; return inner(o.box); }
// parameter `o` = any
function even(o) { return odd(o); }
// parameter `o` = any
function odd(o) { return even(o); }
// parameter `o` = { a?: any; b?: any; }
function ping(o) { o.a; return pong(o); }
// parameter `o` = { a?: any; b?: any; }
function pong(o) { o.b; return ping(o); }
// parameter `node` = { next?: any; value?: number; }
function sum(node) { return node ? node.value * 1 + sum(node.next) : 0; }
// parameter `a` = any
function afterSpread(a, list) { return Math.max(...list, a); }
// parameter `a` = any
function intoRest(a) { return Math.max(1, a) && [].concat(a); }
// The name of a member proposes no built-in type: calling `apply` does not say function.
// parameter `fn` = any
function invoke(fn, self) { return fn.apply(self, arguments); }
// parameter `fn` = any
function named(fn, self) { return fn.name + fn.call(self); }
// parameter `user` = { name?: any; }
function nameOf(user) { return user.name; }
// parameter `o` = any
function text(o) { return o.toString(); }
