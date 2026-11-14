// undefined is in no order with a number or another value that is no object. An object's own code still runs.
"use strict";
let log = "";
const object = n => ({ valueOf() { log += "v" + n; return n; } });
const values = () => [undefined, null, true, false, 0, -0, 1, -1, 2 ** 31, 1.5, NaN, Infinity, -Infinity, "", "a", "1", "undefined", 0n, 1n, -5n, 2n ** 70n, Symbol.iterator, object(1), object(undefined), object("2"), [], [3], new Date(5), () => 1, new Proxy({}, {})];
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
const relations = [(a, b) => a < b, (a, b) => a <= b, (a, b) => a > b, (a, b) => a >= b, (a, b) => { let n = 0; if (a < b) n |= 1; if (a <= b) n |= 2; if (a > b) n |= 4; if (a >= b) n |= 8; return n; }, (a, b) => !(a < b) || !(a >= b) ? a > b ? 1 : 2 : 3];
function ask(relation, a, b) { return attempt(() => relation(a, b)); }
let text = "";
for (const relation of relations) {
  for (const a of values()) {
    for (const b of values()) text += ask(relation, a, b) + (log && "[" + log + "]") + " ", log = "";
    text += "\n";
  }
}
console.log(text);
function greatest(list) { let r = -1, n = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; if (s.rank > r) { r = s.rank; n++; } if (s.rank <= r) n += 2; if (r >= s.rank) n += 4; if (r < s.rank) n += 8; } return r + " " + n; }
for (let round = 0; round < 8; round++) console.log(greatest(Array.from({ length: 40 }, (_, i) => i % 3 === round % 3 ? { rank: i - 5 } : i % 3 === 1 ? { other: i } : round & 1 ? { rank: undefined, z: 1 } : { rank: String(i) })));
