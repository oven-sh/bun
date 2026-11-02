// An iterator that entries(), keys() or values() of a URLSearchParams, Headers or FormData answered goes on where the last walk left it, however it is walked the second time.
const makers = {
  "URLSearchParams of a text": () => new URLSearchParams("a=1&b=2&c=3"),
  "URLSearchParams of a text that is not plain": () => new URLSearchParams("a=1&b=%32&c=3"),
  "URLSearchParams of pairs": () => new URLSearchParams([["a", "1"], ["b", "2"], ["c", "3"]]),
  Headers: () => new Headers({ a: "1", b: "2", c: "3" }),
  FormData: () => { const form = new FormData(); form.append("a", "1"); form.append("b", "2"); form.append("c", "3"); return form; },
};
function nestedEntries() { const v = new URLSearchParams("a=1&b=2&c=3").entries(); let n = 0; for (const each of v) for (const inner of v) n++; return n; }
function nestedKeys() { const v = new URLSearchParams("a=1&b=2&c=3").keys(); let n = 0; for (const each of v) for (const inner of v) n++; return n; }
function nestedValues() { const v = new URLSearchParams("a=1&b=2&c=3").values(); let n = 0; for (const each of v) for (const inner of v) n++; return n; }
function oneBehindTheOther() { const v = new URLSearchParams("a=1&b=2&c=3").entries(); let n = 0; for (const each of v) n++; for (const each of v) n++; return n; }
function leftAndWalkedAgain() { const v = new URLSearchParams("a=1&b=2&c=3").keys(); const seen = []; for (const each of v) { seen.push(each); break; } for (const each of v) seen.push(each); return seen.join(); }
function walkedInLoop() { const v = new URLSearchParams("a=1&b=2&c=3").values(); const seen = []; for (let i = 0; i < 3; i++) for (const each of v) { seen.push(i + each); break; } return seen.join(); }
function walkedOnSomeWays(flag) { const v = new URLSearchParams("a=1&b=2&c=3").entries(); let n = 0; if (flag) for (const each of v) n++; for (const each of v) n += 10; return n; }
function walkedOnce() { let n = 0; for (const [key, value] of new URLSearchParams("a=1&b=2&c=3").entries()) n += Number(value); return n; }
function paramsWalkedTwice() { const v = new URLSearchParams("a=1&b=2&c=3"); let n = 0; for (const each of v) for (const inner of v) n++; return n; }
console.log(nestedEntries(), nestedKeys(), nestedValues(), oneBehindTheOther(), leftAndWalkedAgain(), walkedInLoop(), walkedOnSomeWays(true), walkedOnSomeWays(false), walkedOnce(), paramsWalkedTwice());

for (const [name, make] of Object.entries(makers)) {
  for (const member of ["entries", "keys", "values"]) {
    const show = each => String(each);
    const line = [];
    { const v = make()[member](); let n = 0; for (const each of v) for (const inner of v) n++; line.push("nested " + n); }
    { const v = make()[member](); let n = 0; for (const each of v) n++; for (const each of v) n++; line.push("twice " + n); }
    { const v = make()[member](); for (const each of v) break; line.push("left, then spread " + [...v].map(show).join("|")); }
    { const v = make()[member](); v.next(); line.push("stepped, then Array.from " + Array.from(v, show).join("|")); }
    { const v = make()[member](); const [first] = v; line.push("destructured " + show(first) + ", then walked " + [...v].length); }
    { const v = make()[member](); line.push("spread twice " + [...v, ...v].length); }
    { const v = make()[member](); line.push("its own iterator " + (v[Symbol.iterator]() === v)); }
    console.log(name, member, line.join(" . "));
  }
}
