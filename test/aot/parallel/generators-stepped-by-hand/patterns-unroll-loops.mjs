// The loop of a generator runs at most once for each value that a pattern takes.
let state = 0;
const lines = [];
const say = (...words) => lines.length < 2000 && lines.push(words.map(v => (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v))).join(" "));
const list = JSON.parse("[3,1,4,1,5,9,2,6]");
function* range(a, b) { for (let k = a; k < b; k++) yield k; state++; return "end"; }
function* odd(a, b) { for (let k = a; k < b; k++) if (k & 1) yield k; }
function* two(a, b) { for (let k = a; k < b; k++) { yield k; state += k; yield -k; } }
function* either(a, b) { let k = a; do { if (k > 2) yield "t" + k; else yield k / 2; k++; } while (k < b); yield "last"; yield state; }
function* nested(a, b) { for (let k = a; k < b; k++) { for (let j = 0; j < 2; j++) yield [k, j]; yield "row"; } }
function* leaving(a, b) { for (let k = a; ; k++) { if (k >= b) { state += 5; return; } if (k === 3) break; yield k; } yield "broke"; state += 7; }
function* throwing(a, b) { for (let k = a; k < b; k++) { if (k === 4) throw new Error("four"); yield k; } }
function* counting(a) { let k = 0; while (true) { state += k; yield k++ * a; } }
function* sums(a) { let t = 0; for (;;) { const got = yield t; t += got === undefined ? a : 100; } }
const makers = [range, odd, two, either, nested, leaving, throwing, counting, sums];
function one(x) { const [a] = range(x, x + 2); return a; }
function pairs(x) { const [a, b] = range(x, 3); return say(a, b, state); }
function defaults(x) { const [a = "a", b = state, c = "c"] = range(x, 3); return say(a, b, c); }
function holes(x) { const [, b, , d = "d"] = range(x, 9); return say(b, d); }
function ofOdd(x) { const [a, b, c] = odd(x, 8); return say(a, b, c); }
function ofTwo(x) { const [a, b, c, d] = two(x, 4); return say(a, b, c, d, state); }
function ofEither(x) { const [a, b, c, d] = either(x, 4); return say(a, b, c, d); }
function ofNested(x) { const [a, b, c, d] = nested(x, 5); return say(a, b, c, d); }
function ofLeaving(x) { const [a, b, c] = leaving(x, 5); return say(a, b, c, state); }
function ofThrowing(x) { try { const [a, b, c] = throwing(x, 9); return say(a, b, c); } catch (error) { return say(error.message, x); } }
function ofCounting(x) { const [a, b, c] = counting(x); return say(a, b, c, state); }
function ofSums(x) { const [a, b, c, d] = sums(x); return say(a, b, c, d); }
const tests = [one, pairs, defaults, holes, ofOdd, ofTwo, ofEither, ofNested, ofLeaving, ofThrowing, ofCounting, ofSums];
function run(n) {
    let total = 0;
    for (let turn = 0; turn < n; turn++) {
        for (const x of list) {
            total = (total + one(x) + turn) | 0;
            for (const test of tests) test(x - (turn & 1) * 2);
            const [p, q = 7] = range(x, x + (turn & 3)), [r] = counting(x), [s, t] = two(0, x);
            say(p, q, r, s, t, total, state);
        }
    }
    return total;
}
say(run(6));
for (const maker of makers) { for (const x of list) { try { const [a, b = "none", c] = maker(x % 4, 5); say(maker.name, a, b, c); } catch (error) { say(error.message); } } }
for (const line of lines.slice(0, 200).concat(lines.slice(-90))) console.log(line);
console.log(lines.length, state);
