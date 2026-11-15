// A function calls itself with an integer that can never be an int32.
class S {
    static go(n, a) { if (n) a >> 0; if (a <= 3) return a; return n > 4 ? n : S.go(n + 1, a + 2147483647); }
    static below(n, a) { if (n) a >> 0; if (a >= -3) return a; return n > 4 ? n : S.below(n + 1, a - 2147483648); }
    static twice(n, a) { if (n) a | 0; if (a < 1073741824) return a; return n > 4 ? n : this.twice(n + 1, a * 2); }
    static edge(n, a) { if (n) a & 1; if (a < 1) return a; return n > 4 ? n : S.edge(n + 1, a + 2147483647); }
    static within(n, a) { if (n) a & 1; if (a < 0) return a; return n > 4 ? n : S.within(n + 1, a + 2147483647); }
    static unsigned(n, a) { if (n) a >> 0; if (a >= 0) return a; return n > 4 ? n : S.unsigned(n + 1, a >>> 0); }
    static negated(n, a) { if (n) a >> 0; if (a !== -2147483648) return a; return n > 4 ? n : S.negated(n + 1, -a); }
    static both(a, b, n) { if (a ^ b) a & b; if (a <= 3 || b <= 3) return a - b; return n > 4 ? n : S.both(b + 2147483647, a + 1, n + 1); }
    static mixed(a, b, n) { if (a ^ b) a & b; if (b <= 3) return a - b; return n > 4 ? n : S.mixed(a + 1, b + 2147483647, n + 1); }
    static told(a) { if (a >> 1) a & 1; if (a > 3 && a < 1e9) S.told(a + 2147483647); return a; }
    go(n, a) { if (n) a >> 0; if (a <= 3) return a; return n > 4 ? n : this.go(n + 1, a + 2147483647); }
    sum(n, a) { if (n) a >> 0; if (a <= 3) return a; return 1 + (n > 4 ? n : this.sum(n + 1, a + 2147483647)); }
    list(n, a) { if (n) a >> 0; if (a <= 3) return [a]; return n > 4 ? [n] : [a, ...this.list(n + 1, a + 2147483647)]; }
    safe(n, a) { if (n) a >> 0; if (a <= 3) return a; try { return n > 4 ? JSON.parse("{") : this.safe(n + 1, a + 2147483647); } catch { return -n; } }
}
const arrow = (n, a) => { if (n) a >> 0; if (a <= 3) return a; return n > 4 ? n : arrow(n + 1, a + 2147483647); };
function plain(n, a) { if (n) a << 0; if (a <= 3) return; if (n > 4) return; plain(n + 1, a + 2147483647); }
function indexed(list, a, n) { if (n > 4 || a <= 3) return list[a]; return indexed(list, a + 2147483647, n + 1); }
function shifted(n, a) { if (n) a >> 0; if (a <= 3) return a; return n > 4 ? n : shifted(n + 1, a << 31); }
function past(n, a) { if (n) a >> 0; if (a <= 3) return a; return n > 4 ? n : past(n + 1, a + 2 ** 32); }
function spread(n, a) { if (n) a >> 0; if (a <= 3) return a; return n > 4 ? n : spread(...[n + 1, a + 2147483647]); }
function looped(n, a) { let r = 0; for (let i = 0; i < 2; i++) { if (a > 3) { if (n < 3) r += looped(n + 1, a + 2147483647); } else r += a >> i; } return r; }
const attempt = f => { try { const r = f(); return Array.isArray(r) ? "[" + r + "]" : Object.is(r, -0) ? "-0" : String(r); } catch (error) { return error.constructor.name; } };
const s = new S(), given = [0, 1, -1, 4, 3, -4, 2147483647, -2147483648, 1073741824, 1.5, NaN, -0, Infinity, -Infinity, 4294967296, "5", undefined, null, "x"];
for (const a of given) console.log(String(a), ["go", "below", "twice", "edge", "within", "unsigned", "negated"].map(name => attempt(() => S[name](1, a))).join(), ["go", "sum", "list", "safe"].map(name => attempt(() => s[name](1, a))).join(), [arrow, plain, shifted, past, spread, looped].map(f => attempt(() => f(1, a))).join(), attempt(() => indexed([7, 8, 9, 10, 11], a, 0)), attempt(() => S.both(a, 5, 0)), attempt(() => S.both(5, a, 0)), attempt(() => S.mixed(a, 5, 0)), attempt(() => S.told(a)));
console.log(S.go(1, 1), S.go(1, 5), S.below(0, -5), S.twice(1, 2 ** 30), S.edge(1, 1), S.unsigned(1, -1), S.negated(0, -2147483648), s.go(1, 9), s.sum(1, 9), arrow(1, 9), plain(1, 9), looped(0, 9));
console.log(attempt(() => S.go(1, 10n)), attempt(() => S.go(1, Symbol())), attempt(() => S.go(1, { valueOf: () => 5 })));
class Step { static go(n, a) { if (n) a >> 0; if (a >= 9e9) return a; return Step.go(n, a + 2147483647); } }
console.log(Step.go(1, 1), Step.go(0, 7));
