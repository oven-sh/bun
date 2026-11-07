// Every turn of three small statements, written out in full and not drawn: one loop, one list, two indexes, two sums, a key, a field and a variable of the module.
// Silent wrong answers have stood for a day in turns that anybody writes: an element read, another stored, the first read again; a sum stored to a variable of the module beside an early exit;
// a remainder below zero used as a key. A generator of random programs seldom puts just those three statements into one turn, and what it lays around them hides them. Here nothing lies around them:
// no print in the loop, no closure that holds a variable, no counter of the module but where a statement is one. Each program is built alone and says at its end what every variable holds, with its kind.
//
//   bun write-turn-sweep.ts <folder> <from> <count> [stride] [lists|numbers|objects|records|grids|generators|texts|handed|quiet|pairs]      writes the programs number <from> .. <from> + <count> - 1 of a row; `bun write-turn-sweep.ts count [row]` prints how many it has
//   bun write-turn-sweep.ts named <row> <pattern> <folder> [most]      writes the programs of the row whose names the pattern finds.
//   With a stride that shares no factor with the length of the row, step n is program n * stride: the steps go through the whole row once, and any stretch of them is spread over all lists and heads.
//
// The row goes list by list, head by head, and within a head through all triples, so that its beginning is the plainest: a list of integers, a loop that counts up.
import { mkdirSync, writeFileSync } from "node:fs";

const statements: [string, string][] = [
  ["read-i-int", "x = a[i] | 0;"],
  ["read-i", "x = a[i];"],
  ["read-j", "x = a[j];"],
  ["store-j-masked", "a[j] = (x + c) & 1023;"],
  ["store-j", "a[j] = x + 1;"],
  ["store-i-sum", "a[i] = t;"],
  ["bump-j", "a[j]++;"],
  ["again-i-int", "s = (s + (a[i] | 0) - x) | 0;"],
  ["add-i", "s = s + a[i];"],
  ["carry", "t = t + c * 0.5;"],
  ["carry-x", "t = t + x;"],
  ["module-takes-t", "m = t;"],
  ["module-takes-s", "m = s;"],
  ["read-module", "x = m;"],
  ["field-takes-x", "o.n = x + 1;"],
  ["read-field", "x = o.n;"],
  ["remainder", "k = c % 4;"],
  ["store-k", "a[k] = k;"],
  ["read-k", "x = a[k];"],
  ["break", "if (c === stop) break;"],
  ["continue", "if (c === stop) continue;"],
  ["return", "if (c === stop) return show(s, t, x, k, j);"],
  ["throw", 'if (c === stop) throw new Error("left");'],
  ["callee-stores", "put(a, j, c);"],
  ["callee-throws", "fail(c, stop);"],
  ["read-off-a-row", "x = o.rows[k].n;"],
  ["call-under-k", "o.table[k]();"],
  ["negate", "x = -x;"],
  ["test", "if (x > 3) s++;"],
  ["push", "a.push(c);"],
  ["length", "x = a.length;"],
  ["times-one", "x = 1 * a[i];"],
  ["keep-the-most", "if (x > t) t = x;"],
  ["add-i-or-nothing", "s = s + (a[i] ?? 0);"],
  ["read-the-next", "x = a[i + 1];"],
  ["store-the-next", "a[i + 1] = x;"],
  ["read-the-last", "x = a.at(-1) ?? -1;"],
  ["swap", "[a[i], a[j]] = [a[j], a[i]];"],
  ["a-text-for-a-key", "k = String(i);"],
  ["a-copy", "if (c === stop) a = a.slice();"],
  ["shorten", "if (c === stop) a.length = 4;"],
  ["pop", "if (c === stop) a.pop();"],
  ["is-a-number", 'if (typeof a[i] === "number") s++;'],
  ["one-of-some-integers", "x = weigh(c | 0);"],
  ["add-at-the-counter", "t = t + a[c];"],
  ["store-at-the-counter", "a[c] = c;"],
];
// What a turn narrows or stands in for is used behind the loop too, and one of the calls runs no turn.
const told = "show(s, t, x, k, j, a[0], a.length, o.n)";
const heads: [string, (turn: string) => string][] = [
  ["up", turn => `for (let c = 0; c < n; c++) { ${turn} }`],
  ["below-zero", turn => `for (let c = from | 0; c < 0; c++) { ${turn} }`],
  ["up-in-a-try", turn => `try { for (let c = 0; c < n; c++) { ${turn} } } catch { return "caught " + ${told}; }`],
  ["keys-in-a-try", turn => `let c = -1; try { for (k in a) { c++; ${turn} } } catch { return "caught " + ${told}; }`],
  ["down", turn => `for (let c = n - 1; c >= 0; c--) { ${turn} }`],
  ["while", turn => `let c = -1; while (++c < n) { ${turn} }`],
  ["two-bounds", turn => `for (let c = 0; c < n && c < a.length; c++) { ${turn} }`],
];
const lists: [string, string][] = [
  ["integers", "q"],
  ["fractions", "q + 0.5"],
  ["a-hole", "q"],
];
const triples = statements.length ** 3;
const all = lists.length * heads.length * triples;

function program(at: number, isTypeScript: boolean) {
  const [list, item] = lists[Math.floor(at / (heads.length * triples))];
  const [head, loop] = heads[Math.floor(at / triples) % heads.length];
  const three = [Math.floor(at / statements.length ** 2), Math.floor(at / statements.length), at].map(
    each => statements[each % statements.length],
  );
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const text = `let m${typed("number")} = 5;
function show(...all${typed("any[]")})${typed("string")} { return all.map(one => (typeof one)[0] + (Object.is(one, -0) ? "-0" : String(one))).join(" "); }
function put(list${typed("any")}, at${typed("number")}, value${typed("number")}) { list[at] = value; }
function fail(c${typed("number")}, stop${typed("number")}) { if (c === stop) throw new Error("left"); }
function weigh(x${typed("number")})${typed("number")} { switch (x) { case 0: case 4: case 5: case 10: case 17: case 23: case 64: return 1; default: return 0; } }
function run(a${typed("number[]")}, o${typed("{ n: number; rows: any; table: any }")}, n${typed("number")}, stop${typed("number")}, from${typed("number")})${typed("string")} {
  let s = 0, t = 0.5, x = 0, k${typed("any")} = 0;
  let i = 0, j = 0;
  ${loop(`i = c & 7; j = (c >> 1) & 7; ${three.map(([, statement]) => statement).join(" ")}`)}
  return ${told};
}
for (const [n, stop, from] of JSON.parse("[[17, 0, -4], [17, 9, -4], [0, 0, 0]]")) {
  const a${typed("number[]")} = []; for (let q = 0; q < 8; q++) a.push(${item});${list === "a-hole" ? " delete a[3];" : ""}
  const o = { n: 3, rows: [{ n: 1 }, null, { n: 2 }], table: { 0() {}, 1() { throw new Error("no"); }, 2() {} } };
  let said; try { said = run(a, o, n, stop, from); } catch { said = "threw"; }
  console.log(said + " | " + show(m, o.n, a.length) + " | " + show(...a));
}
export {};
`;
  return { name: `${String(at).padStart(6, "0")}-${list}-${head}-${three.map(([name]) => name).join("--")}`, text };
}

const shows = (typed: (type: string) => string) =>
  `function show(...all${typed("any[]")})${typed("string")} { return all.map(one => (typeof one)[0] + (Object.is(one, -0) ? "-0" : String(one))).join(" "); }`;
const threeOf = (from: [string, string][], at: number) =>
  [Math.floor(at / from.length ** 2), Math.floor(at / from.length), at].map(each => from[each % from.length]);

// The row of numbers: two numbers that the build does not know go through three operations a turn. They begin at the borders: of the integers of 32 bits, of the exact integers, at minus zero, at infinity.
const operations: [string, string][] = [
  ["add-one", "s = s + 1;"],
  ["take-one", "s = s - 1;"],
  ["add-t", "s = s + t;"],
  ["times-t", "s = s * t;"],
  ["add-one-int", "s = (s + 1) | 0;"],
  ["times-t-int", "s = (s * t) | 0;"],
  ["unsigned", "s = s >>> 0;"],
  ["halve-by-shift", "s = s >> 1;"],
  ["double-by-shift", "s = s << 1;"],
  ["negate", "s = -s;"],
  ["remainder", "s = s % t;"],
  ["divide", "s = s / t;"],
  ["imul", "s = Math.imul(s, t);"],
  ["abs", "s = Math.abs(s);"],
  ["floor-of-half", "s = Math.floor(s / 2);"],
  ["round", "s = Math.round(s);"],
  ["trunc", "s = Math.trunc(s);"],
  ["max", "s = Math.max(s, t);"],
  ["min", "s = Math.min(s, t);"],
  ["not", "s = ~s;"],
  ["and", "s = s & t;"],
  ["xor-c", "s = s ^ c;"],
  ["add-c", "s = s + c;"],
  ["times-c", "s = s * c;"],
  ["same", "if (s === t) x++;"],
  ["less", "if (s < t) x++;"],
  ["is-minus-zero", "if (Object.is(s, -0)) x++;"],
  ["is-itself", "if (s !== s) x++;"],
  ["t-takes-s", "t = s;"],
  ["t-grows", "t = t + 0.5;"],
  ["y-gathers", "y = y * s;"],
  ["as-an-index", "y = y + (list[s] ?? 0.25);"],
  ["remainder-of-the-turn", "x = (x + (c % b)) | 0;"],
  ["remainder-of-an-unsigned", "x = (x + (((c + a) >>> 0) % b)) | 0;"],
  ["remainder-of-a-far-dividend", "x = (x + ((c + 4503599627370496) % b)) | 0;"],
];
const headsOfNumbers: [string, (turn: string) => string][] = [
  ["up", turn => `for (let c = 0; c < n; c++) { ${turn} }`],
  ["once", turn => `const c = n; ${turn}`],
  ["down", turn => `for (let c = n; c > -2; c--) { ${turn} }`],
  ["many-turns", turn => `for (let c = 0; c < 1000; c++) { ${turn} }`],
];
function programOfNumbers(at: number, isTypeScript: boolean) {
  const [head, loop] = headsOfNumbers[Math.floor(at / operations.length ** 3) % headsOfNumbers.length];
  const three = threeOf(operations, at);
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const text = `${shows(typed)}
function run(a${typed("number")}, b${typed("number")}, n${typed("number")}, list${typed("number[]")})${typed("string")} {
  let s = a, t = b, x = 0, y = 1;
  ${loop(three.map(([, statement]) => statement).join(" "))}
  return show(s, t, x, y);
}
for (const [a, b] of JSON.parse("[[0,1],[2147483646,3],[-2147483647,-3],[-0,0.5],[4294967295,65536],[9007199254740991,2],[1e999,-1],[0.1,0.2],[5,0],[-7,2],[7,2147483647],[4294967290,1000003]]"))
  console.log(run(a, b, JSON.parse("3"), [1, 2, 3, 4]));
export {};
`;
  return { name: `${String(at).padStart(6, "0")}-numbers-${head}-${three.map(([name]) => name).join("--")}`, text };
}

// The row of objects: a record, an object below it and an instance of a class meet three deeds a turn.
const deeds: [string, string][] = [
  ["store-a", "o.a = c;"],
  ["store-a-text", 'o.a = "t";'],
  ["store-a-fraction", "o.a = c + 0.5;"],
  ["add-c", "o.c = c;"],
  ["delete-a", "delete o.a;"],
  ["delete-b", "delete o.b;"],
  ["read-a", "x = o.a;"],
  ["read-c", "x = o.c;"],
  ["read-a-from-below", "x = q.a;"],
  ["store-a-below", "q.a = c;"],
  ["has-a", 'x = "a" in q ? 1 : 0;'],
  ["owns-a", 'x = Object.hasOwn(o, "a") ? 1 : 0;'],
  ["count-keys", "x = Object.keys(o).length;"],
  ["freeze", "if (c === 2) Object.freeze(o);"],
  ["another-above", "if (c === 2) Object.setPrototypeOf(q, p);"],
  ["call-method", "x = p.m();"],
  ["own-method", "if (c === 2) p.m = () => 9;"],
  ["another-method", "if (c === 2) P.prototype.m = function () { return 7; };"],
  ["read-field", "x = p.n;"],
  ["store-field-fraction", "p.n = c + 0.5;"],
  ["an-accessor", 'if (c === 2) Object.defineProperty(o, "a", { get() { return 5; }, configurable: true });'],
  ["a-fresh-record", "o = { a: c, b: 2 };"],
  ["swap", "[o, q] = [q, o];"],
  ["read-under-k", "x = o[k];"],
  ["store-under-k", "o[k] = c;"],
  ["another-k", 'k = k === "a" ? "b" : "a";'],
  ["walk-keys", "for (const each in q) s += each.length;"],
  ["gather", 's = s + (typeof x === "number" ? x : 100);'],
  ["spread", "o = { ...o, b: c };"],
  ["take-apart", "({ a: x = -1 } = o);"],
  ["a-callee-keeps-the-record", "s += keep(o);"],
  ["a-callee-keeps-the-instance", "s += keep(p);"],
  ["a-callee-keeps-a-fresh-one", "s += keep({ a: c, b: c + 1 });"],
  ["a-list-keeps-the-record", "held.all.push(o);"],
];
// The three are born in the function that does the deeds: what a typed read or store leans on is what the compiler has seen of a cell since its birth, and of a cell that comes in as a parameter it has seen nothing.
const born = "o = { a: 1, b: 2 }; q = Object.create(o); p = new P();";
const headsOfObjects: [string, (turn: string) => string][] = [
  ["up", turn => `${born} for (let c = 0; c < n; c++) { ${turn} }`],
  [
    "up-in-a-try",
    turn => `${born} try { for (let c = 0; c < n; c++) { ${turn} } } catch { return "caught " + show(s, x, k); }`,
  ],
  ["born-in-the-turn", turn => `for (let c = 0; c < n; c++) { ${born} ${turn} }`],
  ["straight", turn => `${born} const c = n; ${turn}`],
];
function programOfObjects(at: number, isTypeScript: boolean) {
  const [head, loop] = headsOfObjects[Math.floor(at / deeds.length ** 3) % headsOfObjects.length];
  const three = threeOf(deeds, at);
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const text = `${shows(typed)}
class P { n${typed("any")} = 1; ${isTypeScript ? "[key: string]: any; " : ""}m()${typed("any")} { return this.n; } }
const held${typed("{ inner: any; all: any[] }")} = { inner: null, all: [] };
function keep(one${typed("any")})${typed("number")} { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; held.inner = one; return work; }
function run(n${typed("number")})${typed("string")} {
  let s = 0, x${typed("any")} = 0, k = "a", o${typed("any")}, q${typed("any")}, p${typed("any")};
  ${loop(three.map(([, statement]) => statement).join(" "))}
  return show(s, x, k) + " | " + JSON.stringify([o, q, p]) + " | " + show(q.a, p.m(), Object.isFrozen(o));
}
for (const n of [JSON.parse("1"), JSON.parse("2"), JSON.parse("5")]) {
  let said; try { said = run(n); } catch { said = "threw"; }
  const fill = []; for (let i = 0; i < 50; i++) fill.push({ a: -i, b: -i, c: -i });
  console.log(said + " | " + show(new P().m(), fill.length) + " | " + JSON.stringify(held));
  held.inner = null; held.all.length = 0;
}
export {};
`;
  return { name: `${String(at).padStart(6, "0")}-objects-${head}-${three.map(([name]) => name).join("--")}`, text };
}

// The row of records: a list of records, or a grid of numbers, is walked, and a turn does three things with the record or the number in hand, with its neighbors and with the list.
const doings: [string, string][] = [
  ["sum-n", "s = s + r.n;"],
  ["sum-n-int", "s = (s + r.n) | 0;"],
  ["sum-m", "t = t + r.m;"],
  ["store-n", "r.n = c;"],
  ["store-n-fraction", "r.n = c + 0.5;"],
  ["store-n-text", 'if (c === stop) r.n = "7";'],
  ["bump-n", "r.n++;"],
  ["add-a-name", "if (c === stop) r.extra = c;"],
  ["delete-m", "if (c === stop) delete r.m;"],
  ["read-another", "x = all[j].n;"],
  ["store-another", "all[j].n = c;"],
  ["again-n", "s = s + r.n - x;"],
  ["keep-n", "x = r.n;"],
  ["push-a-record", "if (c === stop) all.push({ n: 100, m: 0.5 });"],
  ["push-an-odd-record", "if (c === stop) all.push({ m: 0.5, n: 100 });"],
  ["replace-the-next", "if (c === stop) all[j] = { n: -1, m: -0.5 };"],
  ["shorten", "if (c === stop) all.length = 2;"],
  ["a-hole", "if (c === stop) delete all[j];"],
  ["most", "if (r.n > x) x = r.n;"],
  ["count-keys", "s = s + Object.keys(r).length;"],
  ["take-apart", "({ n: x } = r);"],
  ["callee-reads", "s = s + take(r);"],
  ["callee-stores", "lay(r, c);"],
  ["break", "if (c === stop) break;"],
  ["continue", "if (c === stop) continue;"],
  ["throw", 'if (c === stop) throw new Error("left");'],
  ["module-takes-s", "m = s;"],
  ["freeze", "if (c === stop) Object.freeze(r);"],
];
const saysOfRecords = "show(s, t, x, c, all.length, all[0]?.n)";
const headsOfRecords: [string, (turn: string) => string][] = [
  ["of", turn => `for (const r of all) { c++; j = (c + 1) % all.length; ${turn} }`],
  [
    "counted",
    turn => `for (let i = 0; i < all.length; i++) { const r = all[i]; c++; j = (c + 1) % all.length; ${turn} }`,
  ],
  [
    "of-in-a-try",
    turn =>
      `try { for (const r of all) { c++; j = (c + 1) % all.length; ${turn} } } catch { return "caught " + ${saysOfRecords}; }`,
  ],
  [
    "twice",
    turn => `for (let round = 0; round < 2; round++) for (const r of all) { c++; j = (c + 1) % all.length; ${turn} }`,
  ],
  [
    "for-each",
    turn =>
      `all.forEach(r => { c++; j = (c + 1) % all.length; ${turn.replace(/\b(?:break|continue);/g, "return;")} });`,
  ],
  // The loop goes by a variable of the module. In the lists with a trap a getter among the records writes that variable.
  [
    "up-to-a-bound-of-the-module",
    turn => `for (let i = 0; i < limit; i++) { const r = all[i & 3]; c++; j = (c + 1) % all.length; ${turn} }`,
  ],
];
const kindsOfRecords = ["records", "a-trap-among-them"];
function programOfRecords(at: number, isTypeScript: boolean) {
  const kind = kindsOfRecords[Math.floor(at / (headsOfRecords.length * doings.length ** 3)) % kindsOfRecords.length];
  const [head, loop] = headsOfRecords[Math.floor(at / doings.length ** 3) % headsOfRecords.length];
  const three = threeOf(doings, at);
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const text = `let m = 5, limit = 12;
${shows(typed)}
function take(r${typed("any")})${typed("number")} { return r.n; }
function lay(r${typed("any")}, value${typed("number")}) { r.n = value; }
function run(all${typed("any[]")}, stop${typed("number")})${typed("string")} {
  let s = 0, t = 0.5, x${typed("any")} = 0, c = -1, j = 0;
  ${loop(three.map(([, statement]) => statement).join(" "))}
  return ${saysOfRecords};
}
for (const stop of [JSON.parse("0"), JSON.parse("2"), JSON.parse("99")]) {
  const all${typed("any[]")} = []; for (let q = 0; q < 6; q++) all.push({ n: q, m: q + 0.5 });${kind === "records" ? "" : `\n  all[2] = Object.defineProperty({ m: 2.5 }, "n", { get() { limit = 2.5; return 1; }, set() {}, enumerable: true, configurable: true });`}\n  limit = 12;
  let said; try { said = run(all, stop); } catch { said = "threw"; }
  console.log(said + " | " + show(m, limit, all.length) + " | " + JSON.stringify(all));
}
export {};
`;
  return { name: `${String(at).padStart(6, "0")}-${kind}-${head}-${three.map(([name]) => name).join("--")}`, text };
}

// The row of grids: a list of lists of numbers is walked by a loop in a loop.
const steps: [string, string][] = [
  ["sum", "s += v;"],
  ["sum-int", "s = (s + v) | 0;"],
  ["sum-times", "t = t + v * 0.5;"],
  ["times-one", "x = 1 * v;"],
  ["most", "if (v > x) x = v;"],
  ["store-here", "row[k] = c;"],
  ["store-fraction", "row[k] = c + 0.5;"],
  ["store-beside", "row[(k + 1) % row.length] = c;"],
  ["store-in-another-row", "grid[0][k] = c;"],
  ["read-again", "s = s + row[k] - v;"],
  ["read-the-first-row", "x = grid[0][k];"],
  ["push", "if (c === stop) row.push(9);"],
  ["a-hole", "if (c === stop) delete row[k];"],
  ["a-text", 'if (c === stop) row[k] = "7";'],
  ["another-row", "if (c === stop) grid[1] = [7, 8, 9];"],
  ["shorten", "if (c === stop) row.length = 1;"],
  ["break", "if (c === stop) break;"],
  ["continue", "if (c === stop) continue;"],
  ["leave-both", "if (c === stop) break outer;"],
  ["throw", 'if (c === stop) throw new Error("left");'],
  ["module-takes-s", "m = s;"],
  ["kind", 'if (typeof v !== "number") s = s + 1000;'],
];
const headsOfGrids: [string, (turn: string) => string][] = [
  ["of-in-of", turn => `outer: for (const row of grid) { k = -1; for (const v of row) { c++; k++; ${turn} } }`],
  [
    "counted-in-counted",
    turn =>
      `outer: for (let i = 0; i < grid.length; i++) { const row = grid[i]; for (k = 0; k < row.length; k++) { const v = row[k]; c++; ${turn} } }`,
  ],
  [
    "of-in-counted",
    turn =>
      `outer: for (let i = 0; i < grid.length; i++) { const row = grid[i]; k = -1; for (const v of row) { c++; k++; ${turn} } }`,
  ],
  [
    "of-in-of-in-a-try",
    turn =>
      `try { outer: for (const row of grid) { k = -1; for (const v of row) { c++; k++; ${turn} } } } catch { return "caught " + show(s, t, x, c, k); }`,
  ],
];
const kindsOfGrids: [string, string][] = [
  ["integers", "q * 3 + p"],
  ["fractions", "q * 3 + p + 0.5"],
];
function programOfGrids(at: number, isTypeScript: boolean) {
  const [kind, item] = kindsOfGrids[Math.floor(at / (headsOfGrids.length * steps.length ** 3)) % kindsOfGrids.length];
  const [head, loop] = headsOfGrids[Math.floor(at / steps.length ** 3) % headsOfGrids.length];
  const three = threeOf(steps, at);
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const text = `let m = 5;
${shows(typed)}
function run(grid${typed("any[][]")}, stop${typed("number")})${typed("string")} {
  let s = 0, t = 0.5, x${typed("any")} = 0, c = -1, k = -1;
  ${loop(three.map(([, statement]) => statement).join(" "))}
  return show(s, t, x, c, k);
}
for (const stop of [JSON.parse("0"), JSON.parse("4"), JSON.parse("99")]) {
  const grid${typed("any[][]")} = []; for (let q = 0; q < 3; q++) { const row${typed("any[]")} = []; for (let p = 0; p < 3; p++) row.push(${item}); grid.push(row); }
  let said; try { said = run(grid, stop); } catch { said = "threw"; }
  console.log(said + " | " + show(m) + " | " + JSON.stringify(grid));
}
export {};
`;
  return {
    name: `${String(at).padStart(6, "0")}-grids-${kind}-${head}-${three.map(([name]) => name).join("--")}`,
    text,
  };
}

// The row of generators: a generator walks a list or a view, a `for...of` takes what it yields, and a turn of the consumer does three things, some of them to what the generator walks.
const takings: [string, string][] = [
  ["sum", "s += x;"],
  ["sum-int", "s = (s + x) | 0;"],
  ["count", "n++;"],
  ["carry", "t = t + x * 0.5;"],
  ["a-name-is-laid", "mark(v, x);"],
  ["its-length-is-laid-over", "cover(v, x);"],
  ["an-element-is-stored", "if (x === 2) v[3] = 9;"],
  ["it-grows", "if (x === 2) grow(v);"],
  ["break", "if (x === 2) break;"],
  ["continue", "if (x === 2) continue;"],
  ["return", "if (x === 3) return show(s, t, n, last);"],
  ["throw", 'if (x === 3) throw new Error("left");'],
  ["last", "last = x;"],
  ["most", "if (x > last) last = x;"],
  ["module-takes-s", "m = s;"],
  ["kept", "out.push(x);"],
  ["its-length", "s += v.length;"],
  ["its-first", "s += v[0];"],
  ["a-remainder", "last = x % 2;"],
];
const producers: [string, string][] = [
  ["counted", "for (let i = 0; i < v.length; i++) yield v[i];"],
  ["of", "for (const each of v) yield each;"],
  ["while", "let i = 0; while (i < v.length) yield v[i++];"],
  ["with-a-way-out", "for (let i = 0; i < v.length; i++) { if (v[i] > 100) return; yield v[i]; }"],
  ["handed-on", "yield* v;"],
  ["down", "for (let i = v.length - 1; i >= 0; i--) yield v[i];"],
];
const walked: [string, string, string][] = [
  ["integers", "[1, 2, 3, 4].map(each => each)", "number[]"],
  ["fractions", "[1, 2, 3, 4.5].map(each => each)", "number[]"],
  ["floats", "new Float64Array([1, 2, 3, 4])", "Float64Array"],
  ["bytes", "new Uint8Array([1, 2, 3, 4])", "Uint8Array"],
];
const consumers: [string, (turn: string) => string][] = [
  ["of", turn => `for (const x of items(v)) { ${turn} }`],
  [
    "of-in-a-try",
    turn => `try { for (const x of items(v)) { ${turn} } } catch { return "caught " + show(s, t, n, last); }`,
  ],
];
function programOfGenerators(at: number, isTypeScript: boolean) {
  const cube = takings.length ** 3;
  const [kind, made, type] = walked[Math.floor(at / (consumers.length * producers.length * cube)) % walked.length];
  const [consumer, loop] = consumers[Math.floor(at / (producers.length * cube)) % consumers.length];
  const [producer, body] = producers[Math.floor(at / cube) % producers.length];
  const three = threeOf(takings, at);
  const typed = (text: string) => (isTypeScript ? `: ${text}` : "");
  const text = `let m = 5;
${shows(typed)}
function* items(v${typed(type)})${typed("Generator<number>")} { ${body} }
const marks${typed("((v: any, x: number) => void)[]")} = [(v, x) => { if (x === 2) v.note = "seen"; }];
const mark = marks[JSON.parse("0")];
const covers${typed("((v: any, x: number) => void)[]")} = [(v, x) => { if (x === 2) Object.defineProperty(v, "length", { value: 3 }); }];
const cover = covers[JSON.parse("0")];
function grow(v${typed("any")}) { if (Array.isArray(v)) v.push(7); }
function run(v${typed(type)}, out${typed("number[]")})${typed("string")} {
  let s = 0, t = 0.5, n = 0, last = -1;
  ${loop(three.map(([, statement]) => statement).join(" "))}
  return show(s, t, n, last);
}
for (let round = 0; round < 2; round++) {
  const v = ${made}, out${typed("number[]")} = [];
  let said; try { said = run(v, out); } catch { said = "threw"; }
  console.log(said + " | " + show(m, v.length) + " | " + show(...v) + " | " + show(...out));
}
export {};
`;
  return {
    name: `${String(at).padStart(6, "0")}-generators-${kind}-${consumer}-${producer}-${three.map(([name]) => name).join("--")}`,
    text,
  };
}

// The row of texts: two texts, a table under texts and a list of texts go through three steps a turn: texts are put together, cut, compared, and used as keys.
const writings: [string, string][] = [
  ["append", 't += "ab";'],
  ["append-the-turn", "t += c;"],
  ["append-wide", 't += "é中";'],
  ["append-u", "t = t + u;"],
  ["prepend", 't = "x" + t;'],
  ["a-template", "t = `${t}-${c}`;"],
  ["cut-the-head", "u = t.slice(1);"],
  ["cut-at-the-turn", "u = t.slice(c);"],
  ["a-stretch", "u = t.substring(1, 3);"],
  ["one-letter", 'u = t[c] ?? "";'],
  ["the-last-letter", 'u = t.at(-1) ?? "";'],
  ["its-length", "s += t.length;"],
  ["a-code", "s += t.charCodeAt(c) | 0;"],
  ["find", 's += t.indexOf("b");'],
  ["same", "if (t === u) s++;"],
  ["less", "if (t < u) s++;"],
  ["upper", "t = t.toUpperCase();"],
  ["replace", 't = t.replace("a", "b");'],
  ["split-and-join", 'u = t.split("a").join("-");'],
  ["replace-by-a-pattern", 't = t.replace(/a+/g, "b");'],
  ["test-a-pattern", "if (/^a.*b$/.test(t)) s++;"],
  ["take-the-digits", 'u = (/(\\d+)/.exec(t) ?? ["", ""])[1];'],
  ["search-a-pattern", "s += t.search(/b/);"],
  ["all-that-match", 'u = t.match(/[a-c]/g)?.join("") ?? "";'],
  ["a-pattern-put-together", 'if (between("a", "b").test(t)) s++;'],
  ["a-pattern-of-two-texts", 'u = t.replace(new RegExp("b" + "+", "g"), "-");'],
  ["empty", 'if (c === stop) t = "";'],
  ["t-takes-u", "t = u;"],
  ["as-a-number", "s += Number(u) | 0;"],
  ["of-a-number", "u = String(c * 0.5);"],
  ["keep", "out.push(t + c);"],
  ["keep-as-it-is", "out.push(t);"],
  ["table-takes", "table.set(t, c);"],
  ["table-gives", "s += table.get(u) ?? 0;"],
  ["table-counts", "table.set(u, (table.get(u) ?? 0) + 1);"],
  ["table-has", "if (table.has(t)) s++;"],
  ["record-takes", "record[u] = c;"],
  ["record-gives", "s += record[t] ?? 0;"],
  ["break", "if (c === stop) break;"],
];
const headsOfTexts: [string, (turn: string) => string][] = [
  ["up", turn => `for (let c = 0; c < n; c++) { ${turn} }`],
  ["long", turn => `for (let c = 0; c < n * 40; c++) { ${turn} if (t.length > 400) t = t.slice(0, 7); }`],
  ["letters", turn => `let c = -1; for (const letter of word) { c++; u = letter; ${turn} }`],
];
function programOfTexts(at: number, isTypeScript: boolean) {
  const [head, loop] = headsOfTexts[Math.floor(at / writings.length ** 3) % headsOfTexts.length];
  const three = threeOf(writings, at);
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const text = `${shows(typed)}
function between(open${typed("string")}, close${typed("string")})${typed("RegExp")} { return new RegExp(open + ".*" + close); }
function run(word${typed("string")}, n${typed("number")}, stop${typed("number")}, out${typed("string[]")}, table${typed("Map<string, number>")}, record${typed("Record<string, number>")})${typed("string")} {
  let t = word, u = "a", s = 0;
  ${loop(three.map(([, statement]) => statement).join(" "))}
  return show(t, u, s);
}
for (const word of JSON.parse('["ab", "", "béa", "12"]')) {
  const out${typed("string[]")} = [], table = new Map${isTypeScript ? "<string, number>" : ""}([["a", 1], ["ab", 2]]), record${typed("Record<string, number>")} = { a: 1, ab: 2 };
  console.log(run(word, JSON.parse("6"), JSON.parse("3"), out, table, record) + " | " + out.join() + " | " + [...table].join(";") + " | " + JSON.stringify(record));
}
export {};
`;
  return { name: `${String(at).padStart(6, "0")}-texts-${head}-${three.map(([name]) => name).join("--")}`, text };
}

// The row of what is handed over: a turn calls three times, and what it hands comes out of a list: by a spread, by `apply`, into a rest parameter, into `arguments`. Some steps change the list between the calls,
// walk a short list that is written in the turn, or make an object by a constructor function that calls its base at its head.
const handings: [string, string][] = [
  ["spread-a-literal", "x = ADD3(...[c, 1, 2]);"],
  ["spread-the-list", "x = ADD3(...a);"],
  ["spread-a-text", 'k = JOIN3(..."abc");'],
  ["spread-a-set", "x = ADD3(...new Set([c, 1, 2]));"],
  ["spread-twice", "x = ADD3(...[c], ...[1, 2]);"],
  ["spread-behind-one", "x = ADD3(c, ...a);"],
  ["spread-too-few", "x = ADD3(...[c]);"],
  ["spread-too-many", "x = ADD3(...[c, 1, 2, 3, 4]);"],
  ["spread-a-hole", "x = ADD3(...[c, , 2]);"],
  ["apply-the-list", "x = ADD3.apply(null, a);"],
  ["apply-a-literal", "x = ADD3.apply(null, [c, 1, 2]);"],
  ["apply-what-is-like-a-list", "x = ADD3.apply(null, { length: 2, 0: c, 1: 1 });"],
  ["apply-nothing", "x = ADD3.apply(null);"],
  ["reflect-apply", "x = Reflect.apply(add3, null, a);"],
  ["rest-counts", "s += count(...a);"],
  ["rest-is-kept", "kept = rest(c, x);"],
  ["rest-is-written", "s += writesItsRest(...a);"],
  ["arguments-counted", "s += GIVEN(c, 1, 2);"],
  ["arguments-of-a-spread", "s += GIVEN(...a);"],
  ["arguments-written", "x = WRITES(c, 1);"],
  ["a-default", "x = withDefault(c);"],
  ["a-default-for-undefined", "x = withDefault(undefined, c);"],
  ["new-with-a-spread", "x = new THREE(...a).sum;"],
  ["a-method-with-a-spread", "x = o.add3(...a);"],
  ["a-response-of-a-literal", 'x = new Response("b", { status: 200 + c }).status;'],
  [
    "a-response-through-a-helper",
    'k = respond("b", { status: 200 + c, headers: { a: "h" + c } }).headers.get("a") ?? "";',
  ],
  ["an-heir-is-made", "x = new HEIR(c).sum();"],
  ["an-heir-is-made-of-the-list", "x = new HEIR(...a).sum();"],
  ["a-short-list-is-walked", "for (const y of [1, 2, 3]) s += y;"],
  ["a-short-list-of-the-turn-is-walked", "for (const y of [c, x]) t = t + y;"],
  ["a-short-list-is-left", "for (const y of [1, 2, 3]) { if (y === 2) break; s += y; }"],
  ["the-list-pushes-itself", "s += a.push(...a);"],
  ["the-list-joined-to-itself", "kept = a.concat(...a);"],
  ["the-list-grows", "a.push(c);"],
  ["the-list-shrinks", "a.length = 2;"],
  ["the-list-takes-a-text", 'a[1] = "t";'],
  ["the-list-takes-a-hole", "delete a[1];"],
  ["another-way-to-walk-the-list", "if (c === stop) a[Symbol.iterator] = function* () { yield 7; yield 8; yield 9; };"],
  ["break", "if (c === stop) break;"],
];
const headsOfHandings: [string, (turn: string) => string][] = [
  ["up", turn => `for (let c = 0; c < n; c++) { ${turn} }`],
  [
    "up-in-a-try",
    turn => `try { for (let c = 0; c < n; c++) { ${turn} } } catch { return "caught " + show(s, t, x, k); }`,
  ],
  [
    "straight",
    turn => `const c = n; ${turn.replace(/if \(c === stop\) break;/g, "if (c === stop) return show(s, t, x, k);")}`,
  ],
];
const listsHanded: [string, string][] = [
  ["integers", "[1, 2, 3]"],
  ["fractions", "[0.5, 1.5, 2.5, 3.5]"],
  ["mixed", '[1, "b", undefined]'],
  // Of these two the build does not know that they are lists.
  ["integers-that-nobody-knows", 'JSON.parse("[1, 2, 3]")'],
  ["mixed-that-nobody-knows", `JSON.parse('[1, "b", null]')`],
];
function programOfHandings(at: number, isTypeScript: boolean) {
  const [kind, list] =
    listsHanded[Math.floor(at / (headsOfHandings.length * handings.length ** 3)) % listsHanded.length];
  const [head, loop] = headsOfHandings[Math.floor(at / handings.length ** 3) % headsOfHandings.length];
  const three = threeOf(handings, at);
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const loose = (name: string) => (isTypeScript ? `(${name} as any)` : name);
  const turn = three
    .map(([, statement]) => statement)
    .join(" ")
    .replace(/\b(ADD3|JOIN3|GIVEN|WRITES|THREE|HEIR)\b/g, name =>
      loose({ ADD3: "add3", JOIN3: "join3", GIVEN: "given", WRITES: "writes", THREE: "Three", HEIR: "Heir" }[name]!),
    );
  const self = isTypeScript ? "this: any, " : "";
  const text = `${shows(typed)}
function add3(x${typed("any")}, y${typed("any")}, z${typed("any")})${typed("any")} { return x + y + z; }
function join3(x${typed("any")}, y${typed("any")}, z${typed("any")})${typed("string")} { return z + "" + y + x; }
function count(...all${typed("any[]")})${typed("number")} { return all.length; }
function rest(...all${typed("any[]")})${typed("any[]")} { return all; }
function writesItsRest(...all${typed("any[]")})${typed("number")} { all[0] = -1; all.push(0); return all.length; }
function given(${isTypeScript ? "..._: any[]" : ""})${typed("number")} { return arguments.length; }
function writes(x${typed("any")}, y${typed("any")})${typed("any")} { arguments[0] = 9; return x + y; }
const respond = (body${typed("string")}, given${typed("any")}) => new Response(body, given);
function withDefault(x${typed("any")} = 4, y${typed("any")} = x + 1)${typed("any")} { return x * 10 + y; }
class Three { sum${typed("any")}; constructor(x${typed("any")}, y${typed("any")}, z${typed("any")}) { this.sum = x + y + z; } }
function Base(${self}x${typed("any")}) { this.x = x; this.twice = x + x; }
Base.prototype.sum = function (${isTypeScript ? "this: any" : ""}) { return this.x + this.twice + this.more; };
function Heir(${self}x${typed("any")}, more${typed("any")} = 1) { Base.call(this, x); this.more = more; }
Object.setPrototypeOf(Heir.prototype, Base.prototype);
function run(a${typed("any")}, n${typed("number")}, stop${typed("number")})${typed("string")} {
  let s = 0, t${typed("any")} = 0.5, x${typed("any")} = 0, k = "", kept${typed("any[]")} = [];
  const o = { add3(x${typed("any")}, y${typed("any")}, z${typed("any")})${typed("any")} { return x + y + z + 100; } }${isTypeScript ? " as any" : ""};
  ${loop(turn)}
  return show(s, t, x, k) + " | " + kept.join() + " | " + a.join("");
}
for (const [n, stop] of JSON.parse("[[1, 1], [4, 2], [4, 99]]")) {
  const a${typed("any")} = ${list};
  let said; try { said = run(a, n, stop); } catch { said = "threw"; }
  console.log(said + " | " + show(a.length) + " | " + JSON.stringify(a));
}
export {};
`;
  return {
    name: `${String(at).padStart(6, "0")}-handed-${kind}-${head}-${three.map(([name]) => name).join("--")}`,
    text,
  };
}

// The row of quiet turns: nothing in a turn calls, and the element is the one at the counter. Such loops are the ones that a compiler lays out anew, and in the row of lists only one turn in ten is so quiet.
const quietSteps: [string, string][] = [
  ["read", "x = a[c];"],
  ["read-int", "x = a[c] | 0;"],
  ["sum", "s += a[c];"],
  ["sum-int", "s = (s + a[c]) | 0;"],
  ["sum-fraction", "t = t + a[c];"],
  ["sum-of-x", "s += x;"],
  ["sum-by-a-local", "{ const v = a[c]; s += v; }"],
  ["hash", "s = (Math.imul(s, 31) + a[c]) | 0;"],
  ["most", "if (a[c] > t) t = a[c];"],
  ["the-least-of-a-sum", "x = Math.min(x + a[c], s + 1);"],
  ["three-stores-in-a-row", "if (c + 2 < a.length) { a[c] = s; a[c + 1] = t; a[c + 2] = x; }"],
  ["module-sums", "m += a[c];"],
  ["module-takes-s", "m = s;"],
  ["module-takes-t", "m = t;"],
  ["field-sums", "o.n += a[c];"],
  ["field-takes-s", "o.n = s;"],
  ["store-s", "a[c] = s;"],
  ["store-t", "a[c] = t;"],
  ["store-the-next", "if (c + 1 < a.length) a[c + 1] = x;"],
  ["read-the-one-before", "x = a[c - 1];"],
  ["shorten", "if (c === stop) LOOSE.length = 4;"],
  ["sum-off-a-view-of-the-module", "s = (s + widths[c]) | 0;"],
  ["sum-off-a-field-of-an-instance-of-the-module", "t += kept.l[c] * 2;"],
  ["the-other-takes-it", "b[c] = a[c];"],
  ["sum-of-the-other", "s += b[c];"],
  ["count-the-marked", "if (a[c] === mark) h++;"],
  ["a-field-at-the-marked", "if (a[c] === mark) o.n = o.n + c;"],
  ["break-at-the-marked", "if (a[c] === mark) break;"],
  ["break", "if (c === stop) break;"],
  ["continue", "if (c === stop) continue;"],
  ["return", "if (c === stop) return show(s, t, x, h);"],
  ["throw", 'if (c === stop) throw new Error("left");'],
];
const headsOfQuiet: [string, (turn: string) => string][] = [
  ["to-the-length", turn => `for (let c = 0; c < a.length; c++) { ${turn} }`],
  ["to-a-bound", turn => `for (let c = 0; c < n; c++) { ${turn} }`],
  ["to-a-whole-bound", turn => `n |= 0; for (let c = 0; c < n; c++) { ${turn} }`],
  ["to-a-written-bound", turn => `for (let c = 0; c < 8; c++) { ${turn} }`],
  ["down", turn => `for (let c = a.length - 1; c >= 0; c--) { ${turn} }`],
  [
    "in-a-try",
    turn => `try { for (let c = 0; c < a.length; c++) { ${turn} } } catch { return "caught " + show(s, t, x, h); }`,
  ],
];
const kindsOfQuiet: [string, string, string][] = [
  ["integers", "[3, 1, 4, 1, 5, 9, 2, 6]", "[0, 0, 0, 0, 0, 0, 0, 0]"],
  ["fractions", "[3.5, 1.5, 4.5, 1.5, 5.5, 9, 2.5, 6.5]", "[0.5, 0, 0, 0, 0, 0, 0, 0]"],
  ["a-hole", "[3, 1, , 1, 5, 9, 2, 6]", "[0, 0, 0, 0, 0, 0, 0, 0]"],
  ["a-fraction-late", "[3, 1, 4, 1, 5, 9, 2.5, 6]", "[0, 0, 0, 0, 0, 0, 0, 0]"],
  ["whole-numbers-in-a-view", "new Int32Array([3, 1, 4, 1, 5, 9, 2, 6])", "new Int32Array(8)"],
  ["fractions-in-a-view", "new Float64Array([3.5, 1.5, 4.5, 1.5, 5.5, 9, 2.5, 6.5])", "new Float64Array(8)"],
  ["one-list-under-two-names", "[3, 1, 4, 1, 5, 9, 2, 6]", ""],
  // Of this one the build does not know that it is a list.
  ["integers-that-nobody-knows", 'JSON.parse("[3, 1, 4, 1, 5, 9, 2, 6]")', "[0, 0, 0, 0, 0, 0, 0, 0]"],
  // Nor of this one that it is none.
  ["a-text-that-nobody-knows", `JSON.parse('"31415926"')`, "[0, 0, 0, 0, 0, 0, 0, 0]"],
];
function programOfQuiet(at: number, isTypeScript: boolean) {
  const [kind, list, other] =
    kindsOfQuiet[Math.floor(at / (headsOfQuiet.length * quietSteps.length ** 3)) % kindsOfQuiet.length];
  const [head, loop] = headsOfQuiet[Math.floor(at / quietSteps.length ** 3) % headsOfQuiet.length];
  const three = threeOf(quietSteps, at);
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const type = kind.endsWith("view")
    ? kind.startsWith("whole")
      ? "Int32Array"
      : "Float64Array"
    : kind.startsWith("a-text")
      ? "any"
      : "number[]";
  const text = `let m${typed("number")} = 5;
${shows(typed)}
class Kept { l${typed("number[]")} = []; }
const kept = new Kept();
for (let i = 0; i < 12; i++) kept.l.push(i * 3 + 0.5);
const widths = new Uint16Array([0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3]);
function run(a${typed(type)}, b${typed(type)}, o${typed("{ n: number; l: number[] }")}, n${typed("number")}, stop${typed("number")}, mark${typed("number")})${typed("string")} {
  let s = 0, t = 0.5, x = 0, h = 0;
  ${loop(three.map(([, statement]) => statement).join(" ")).replace(/LOOSE/g, isTypeScript ? "(a as any)" : "a")}
  return show(s, t, x, h, a[0], a.length, b[0], o.n);
}
for (const [n, stop, mark] of JSON.parse("[[8, 0, 9], [5, 3, 1], [11, 99, 7], [0, 0, 3]]")) {
  const a${typed(type)} = ${list}${isTypeScript && kind === "a-hole" ? " as number[]" : ""}, b${typed(type)} = ${other || "a"}, o = { n: 3, l: [2, 7, 1, 8, 2, 8, 1, 8] };
  let said; try { said = run(a, b, o, n, stop, mark); } catch { said = "threw"; }
  console.log(said + " | " + show(m, o.n, a.length) + " | " + show(...a) + " | " + show(...b));
}
export {};
`;
  return {
    name: `${String(at).padStart(6, "0")}-quiet-${kind}-${head}-${three.map(([name]) => name).join("--")}`,
    text,
  };
}

// The row of pairs: the pairs of a Map are walked and taken apart, and a turn does three things with the key, the value and the Map that is being walked.
const dealings: [string, string][] = [
  ["sum-the-values", "s += value;"],
  ["join-the-keys", "k += key;"],
  ["get-it-again", "s += map.get(key) ?? -1;"],
  ["has-b", 'if (map.has("b")) h++;'],
  ["its-size", "s += map.size;"],
  ["set-the-same-key", "map.set(key, value + 1);"],
  ["set-a-fraction", "map.set(key, 0.5);"],
  ["set-a-text", 'map.set(key, "t");'],
  ["set-a-new-key", 'if (c === stop) map.set("z" + c, 9);'],
  ["set-an-object-as-key", "if (c === stop) map.set(o, c);"],
  ["delete-this", "map.delete(key);"],
  ["delete-c", 'map.delete("c");'],
  ["delete-the-first", 'if (c === stop) map.delete("a");'],
  ["delete-and-set-again", "if (c < 3) { map.delete(key); map.set(key, value); }"],
  ["clear", "if (c === stop) map.clear();"],
  ["walk-it-inside", "for (const [, inner] of map) t += inner;"],
  ["walk-its-keys-inside", "for (const inner of map.keys()) k += inner;"],
  ["a-way-of-its-own", 'if (c === stop) map[Symbol.iterator] = function* () { yield ["own", 7]; };'],
  ["keep-the-value", "kept.push(value);"],
  ["a-field-takes-the-value", "o.n = value;"],
  ["the-module-takes-the-sum", "m = s;"],
  ["break", "if (c === stop) break;"],
  ["continue", "if (c === stop) continue;"],
  ["return", "if (c === stop) return show(s, t, k, h);"],
  ["throw", 'if (c === stop) throw new Error("left");'],
];
// A key that is deleted and set again in one turn comes to the end of the Map and is walked again, for ever: every head ends behind twenty turns.
const headsOfPairs: [string, (turn: string) => string][] = [
  ["of-the-map", turn => `for (const [key, value] of map) { if (++c > 20) break; ${turn} }`],
  ["of-its-entries", turn => `for (const [key, value] of map.entries()) { if (++c > 20) break; ${turn} }`],
  ["a-pair-in-hand", turn => `for (const pair of map) { const [key, value] = pair; if (++c > 20) break; ${turn} }`],
  [
    "in-a-try",
    turn =>
      `try { for (const [key, value] of map) { if (++c > 20) break; ${turn} } } catch { return "caught " + show(s, t, k, h); }`,
  ],
  [
    "for-each",
    turn =>
      `map.forEach((value${"ANY"}, key${"ANY"}) => { if (++c > 20) return; ${turn.replace(/if \(c === stop\) (?:break|continue|return show\(s, t, k, h\));/g, "if (c === stop) return;")} });`,
  ],
];
const kindsOfMaps: [string, string][] = [
  ["texts-to-integers", 'new Map(PAIRS[["a", 1], ["b", 2], ["c", 3], ["d", 4]])'],
  ["integers-to-fractions", "new Map(PAIRS[[1, 0.5], [2, 1.5], [3, 2.5]])"],
  ["an-heir-with-a-way-of-its-own", 'new Heir(PAIRS[["a", 1], ["b", 2]])'],
  ["an-heir-as-made", 'new Plain(PAIRS[["a", 1], ["b", 2], ["c", 3]])'],
  ["empty", "new Map(PAIRS[])"],
];
function programOfPairs(at: number, isTypeScript: boolean) {
  const [kind, made] = kindsOfMaps[Math.floor(at / (headsOfPairs.length * dealings.length ** 3)) % kindsOfMaps.length];
  const [head, loop] = headsOfPairs[Math.floor(at / dealings.length ** 3) % headsOfPairs.length];
  const three = threeOf(dealings, at);
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const text = `let m${typed("any")} = 5;
${shows(typed)}
class Heir extends Map${isTypeScript ? "<any, any>" : ""} { *[Symbol.iterator]()${typed("any")} { yield ["s", 7]; yield ["t", 8]; } }
class Plain extends Map${isTypeScript ? "<any, any>" : ""} {}
function run(map${typed("any")}, o${typed("any")}, kept${typed("any[]")}, stop${typed("number")})${typed("string")} {
  let s${typed("any")} = 0, t${typed("any")} = 0.5, k = "", h = 0, c = -1;
  ${loop(three.map(([, statement]) => statement).join(" ")).replace(/ANY/g, typed("any"))}
  return show(s, t, k, h, map.size);
}
for (const stop of [JSON.parse("0"), JSON.parse("1"), JSON.parse("99")]) {
  const map = ${made.replace("PAIRS", isTypeScript ? "<any>" : "")}, o = { n: 3 }, kept${typed("any[]")} = [];
  let said; try { said = run(map, o, kept, stop); } catch { said = "threw"; }
  console.log(said + " | " + show(m, o.n, map.size) + " | " + kept.join() + " | " + [...Map.prototype.entries.call(map)].map(([key, value]) => String(typeof key === "object" ? "o" : key) + "=" + String(value)).join());
}
export {};
`;
  return {
    name: `${String(at).padStart(6, "0")}-pairs-${kind}-${head}-${three.map(([name]) => name).join("--")}`,
    text,
  };
}

// The row of what is held: one list, and where the function finds it: in a parameter, a field of a record or of `this`, a variable of the module, a captured variable, an element of another list, under a local name
// for the stores and through the field for the reads. A turn that stores whole numbers into a list and reads the same list through a field stopped the build where the same turn over a parameter was built.
const heldSteps: [string, string][] = [
  ["read", "x = READ[c];"],
  ["read-the-next", "x = READ[c + 1];"],
  ["read-elsewhere", "s += READ[(c + 3) & 7];"],
  ["sum-int", "s = (s + READ[c]) | 0;"],
  ["sum-fraction", "t = t + READ[c];"],
  ["count-the-next-marked", "if (READ[c + 1] === mark) h++;"],
  ["store-zero", "WRITE[c] = 0;"],
  ["store-the-counter-masked", "WRITE[c] = c & 7;"],
  ["store-s", "WRITE[c] = s;"],
  ["store-t", "WRITE[c] = t;"],
  ["store-the-next", "if (c + 1 < READ.length) WRITE[c + 1] = x;"],
  ["raise", "WRITE[c]++;"],
  ["push", "if (c === stop) WRITE.push(c);"],
  ["break", "if (c === stop) break;"],
];
const headsOfHeld: [string, (turn: string) => string][] = [
  ["to-the-length", turn => `for (let c = 0; c < READ.length; c++) { ${turn} }`],
  ["to-a-bound", turn => `for (let c = 0; c < n; c++) { ${turn} }`],
  ["to-a-written-bound", turn => `for (let c = 0; c < 8; c++) { ${turn} }`],
  ["down", turn => `for (let c = READ.length - 1; c >= 0; c--) { ${turn} }`],
];
const kindsOfHeld: [string, string][] = [
  ["integers", "[3, 1, 4, 1, 5, 9, 2, 6]"],
  ["integers-pushed", "pushed(8)"],
  ["fractions", "[3.5, 1.5, 4.5, 1.5, 5.5, 9, 2.5, 6.5]"],
  ["integers-that-nobody-knows", 'JSON.parse("[3, 1, 4, 1, 5, 9, 2, 6]")'],
];
/** How the reads and the stores spell the list, what stands round the body, and how it is called with the list `list`. */
type Holder = [
  name: string,
  read: string,
  write: string,
  around: (body: string, typed: (type: string) => string) => string,
  call: string,
];
const rest = (typed: (type: string) => string) => `n${typed("number")}, stop${typed("number")}, mark${typed("number")}`;
const holders: Holder[] = [
  ["a-parameter", "a", "a", (body, typed) => `function run(a${typed("number[]")}, ${rest(typed)})${typed("string")} { ${body} }`, "run(list, n, stop, mark)"],
  ["a-field-of-a-record", "box.a", "box.a", (body, typed) => `function run(box${typed("{ a: number[] }")}, ${rest(typed)})${typed("string")} { ${body} }`, "run({ a: list }, n, stop, mark)"],
  ["a-field-of-this", "this.a", "this.a", (body, typed) => `class Host { a${typed("number[]")}; constructor(a${typed("number[]")}) { this.a = a; } run(${rest(typed)})${typed("string")} { ${body} } }`, "new Host(list).run(n, stop, mark)"],
  ["a-variable-of-the-module", "held", "held", (body, typed) => `let held${typed("number[]")} = [];\nfunction run(${rest(typed)})${typed("string")} { ${body} }`, "((held = list), run(n, stop, mark))"],
  ["a-captured-variable", "a", "a", (body, typed) => `function make(a${typed("number[]")}) { return function run(${rest(typed)})${typed("string")} { ${body} }; }`, "make(list)(n, stop, mark)"],
  ["an-element-of-a-list-of-lists", "rows[k]", "rows[k]", (body, typed) => `function run(rows${typed("number[][]")}, k${typed("number")}, ${rest(typed)})${typed("string")} { ${body} }`, "run([[7], list], 1, n, stop, mark)"],
  ["a-local-name-for-the-stores-and-the-field-for-the-reads", "box.a", "a", (body, typed) => `function run(box${typed("{ a: number[] }")}, ${rest(typed)})${typed("string")} { const a = box.a; ${body} }`, "run({ a: list }, n, stop, mark)"],
  ["the-field-for-the-stores-and-a-local-name-for-the-reads", "a", "box.a", (body, typed) => `function run(box${typed("{ a: number[] }")}, ${rest(typed)})${typed("string")} { const a = box.a; ${body} }`, "run({ a: list }, n, stop, mark)"],
]; // prettier-ignore
function programOfHeld(at: number, isTypeScript: boolean) {
  const cube = heldSteps.length ** 3;
  const [holder, read, write, around, call] =
    holders[Math.floor(at / (kindsOfHeld.length * headsOfHeld.length * cube)) % holders.length];
  const [kind, list] = kindsOfHeld[Math.floor(at / (headsOfHeld.length * cube)) % kindsOfHeld.length];
  const [head, loop] = headsOfHeld[Math.floor(at / cube) % headsOfHeld.length];
  const three = threeOf(heldSteps, at);
  const typed = (type: string) => (isTypeScript ? `: ${type}` : "");
  const body =
    `let s = 0, t = 0.5, x = 0, h = 0; ${loop(three.map(([, statement]) => statement).join(" "))} return show(s, t, x, h, READ[0], READ.length);`
      .replace(/READ/g, read)
      .replace(/WRITE/g, write);
  const text = `${shows(typed)}
function pushed(count${typed("number")})${typed("number[]")} { const made${typed("number[]")} = []; for (let i = 0; i < count; i++) made.push((i * 5 + 3) & 7); return made; }
${around(body, typed)}
for (const [n, stop, mark] of JSON.parse("[[8, 0, 9], [5, 3, 1], [11, 99, 7], [0, 0, 3]]")) {
  const list${typed("number[]")} = ${list};
  let said; try { said = ${call}; } catch { said = "threw"; }
  console.log(said + " | " + show(list.length) + " | " + show(...list));
}
export {};
`;
  return {
    name: `${String(at).padStart(6, "0")}-held-${holder}-${kind}-${head}-${three.map(([name]) => name).join("--")}`,
    text,
  };
}

const rows: Record<string, [number, (at: number, isTypeScript: boolean) => { name: string; text: string }]> = {
  lists: [all, program],
  numbers: [headsOfNumbers.length * operations.length ** 3, programOfNumbers],
  objects: [headsOfObjects.length * deeds.length ** 3, programOfObjects],
  records: [kindsOfRecords.length * headsOfRecords.length * doings.length ** 3, programOfRecords],
  grids: [kindsOfGrids.length * headsOfGrids.length * steps.length ** 3, programOfGrids],
  generators: [walked.length * consumers.length * producers.length * takings.length ** 3, programOfGenerators],
  texts: [headsOfTexts.length * writings.length ** 3, programOfTexts],
  handed: [listsHanded.length * headsOfHandings.length * handings.length ** 3, programOfHandings],
  quiet: [kindsOfQuiet.length * headsOfQuiet.length * quietSteps.length ** 3, programOfQuiet],
  pairs: [kindsOfMaps.length * headsOfPairs.length * dealings.length ** 3, programOfPairs],
  held: [holders.length * kindsOfHeld.length * headsOfHeld.length * heldSteps.length ** 3, programOfHeld],
};
if (process.argv[2] === "count") console.log(rows[process.argv[3] ?? "lists"][0]);
else if (process.argv[2] === "named") {
  // The programs of a row whose names a pattern finds: a fault that is known by its cells is asked for by their names, however thin the row has become.
  const [row, pattern, folder, most] = [
    process.argv[3],
    new RegExp(process.argv[4]),
    process.argv[5],
    Number(process.argv[6] ?? 500),
  ];
  const [length, write] = rows[row];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < length && written < most; at++) {
    const isTypeScript = (at & 1) === 1;
    const { name, text } = write(at, isTypeScript);
    if (!pattern.test(name)) continue;
    writeFileSync(`${folder}/${name}.${isTypeScript ? "ts" : "mjs"}`, text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [
    process.argv[2],
    ...[process.argv[3] ?? 0, process.argv[4] ?? 3000, process.argv[5] ?? 1].map(Number),
  ] as [string, number, number, number];
  const [length, write] = rows[process.argv[6] ?? "lists"];
  mkdirSync(folder, { recursive: true });
  for (let step = from; step < Math.min(length, from + count); step++) {
    const at = (step * stride) % length;
    // Every second program is TypeScript.
    const isTypeScript = (at & 1) === 1;
    const { name, text } = write(at, isTypeScript);
    writeFileSync(`${folder}/${name}.${isTypeScript ? "ts" : "mjs"}`, text);
  }
}
