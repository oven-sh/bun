// Where the value goes on, the uses of the expression or the variable that holds it count.
// parameter `o` = { a?: any; }
function orDefault(o) { return (o || {}).a; }
// parameter `o` = { a?: any; }
function andThen(o) { return (o && o).a; }
// parameter `o` = { a?: any; }
function coalesce(o) { return (o ?? null).a; }
// parameter `c` = any
// parameter `o` = { a?: any; }
function choose(c, o) { return (c ? o : null).a; }
// parameter `o` = { a?: any; }
function comma(o) { return (0, o).a; }
// parameter `o` = { a?: any; }
function alias(o) { const same = o; return same.a; }
// parameter `o` = { a?: any; }
function aliasInLoop(o) { for (var i = 0; i < 2; i++) { var same = o; same.a; } }
// parameter `o` = any
function reassignedAlias(o) { let other = o; other = null; return other.a; }
// parameter `opts` = { depth?: any; }
function configure(opts) { opts = opts || {}; return opts.depth; }
// predicted `n` = number
function normalize(n) { if (!n) n = 0; return n; }
// parameter `o` = { a?: number; b: Function; }
function unpack(o) { const { a, b } = o; return b(a * 2); }
// parameter `o` = { a?: any; b?: any; }
function assignPattern(o) { let a, b; ({ a, b } = o); return [a, b]; }
// parameter `o` = { done?: any; }
function later(o) { return function () { return o.done; }; }
// parameter `o` = any
function returned(o) { return o; }
// parameter `o` = any
function stored(o) { return { o, list: [o], text: `${o}` }; }
// parameter `o` = any
function tested(o) { return o ? 1 : !o; }
