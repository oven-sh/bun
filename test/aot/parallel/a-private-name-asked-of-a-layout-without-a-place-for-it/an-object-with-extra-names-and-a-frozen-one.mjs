class P { #x = 1; static is(o) { return #x in o; } } class Q { y = 2; }
const plain = new Q(), more = new Q(), frozen = Object.freeze(new Q()), less = new Q();
more.extra = 1; more["k" + 2] = 2; delete less.y;
const out = []; for (let i = 0; i < 3; i++) out.push(P.is(plain), P.is(more), P.is(frozen), P.is(less));
console.log(out.join(" "));
