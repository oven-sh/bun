// One place in a program that sees two kinds of value. A helper walks what it is given: it fills a list, spreads, destructures, counts, makes a Map or a Set. What it is given is what entries() or values() of
// a member of an object answers; the function is hot with one kind of collection in that member and then gets another. A value of several kinds is walked behind a switch on its kind, and whatever the
// compiler reads of one kind, a size to plan a capacity by, may be read only behind that switch. The other generators of this folder give every use one birth: none of them has such a place.
export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  const kinds: Record<string, string> = {
    integers: "[5, 6, 7]",
    fractions: "[1.5, 2.5, 3.5]",
    texts: "[\"a\", \"b\"]",
    records: "[{ a: 1 }, { a: 2 }]",
    holes: "[1, , 3]",
    emptyList: "[]",
    pairs: "[[\"a\", 1], [\"b\", 2]]",
    map: "new Map([[\"a\", 1], [\"b\", 2], [\"c\", 3]])",
    emptyMap: "new Map()",
    set: "new Set([1, 2, 3, 4])",
    bytes: "new Uint8Array([1, 2, 3])",
    doubles: "new Float64Array([1.5, 2.5])",
    buffer: "Buffer.from(\"abc\")",
    params: "new URLSearchParams(\"a=1&b=2\")",
    headers: "new Headers({ a: \"1\" })",
    proxy: "new Proxy([1, 2], {})",
  };
  const uses: Record<string, string> = {
    fillByForOf: "const r = []; for (const each of v) r.push(each); return r;",
    spread: "return [...v];",
    spreadTwice: "return [...v, ...v];",
    arrayFrom: "return Array.from(v);",
    arrayFromMapped: "return Array.from(v, each => [each]);",
    firstTwo: "const [a, b] = v; return [a, b];",
    firstAndRest: "const [a, ...rest] = v; return [a, rest];",
    countByForOf: "let n = 0; for (const each of v) n++; return n;",
    keepOne: "let kept = null; for (const each of v) if (each !== 5) kept = { each }; return kept.each;",
    keepLast: "let kept; for (const each of v) kept = [each]; return kept[0];",
    newMap: "return new Map(v);",
    newSet: "return new Set(v);",
    fromEntries: "return Object.fromEntries(v);",
  };
  const head = `class Point { constructor(x, y) { this.x = x; this.y = y; } }
class Point3 extends Point { constructor(x, y, z) { super(x, y); this.z = z; } }
function show(r) { try { return r instanceof Map ? "Map " + JSON.stringify([...r]) : r instanceof Set ? "Set " + JSON.stringify([...r]) : typeof r === "bigint" || typeof r === "symbol" || typeof r === "function" ? typeof r + String(r) : r === undefined ? "undefined" : Object.is(r, -0) ? "-0" : typeof r === "number" ? String(r) : JSON.stringify(r, (key, value) => (typeof value === "bigint" ? "big" + value : value === undefined ? "undefined" : typeof value === "number" && value !== value ? "NaN" : value)); } catch (e) { return "cannot be shown: " + e.name; } }
function attempt(v) { try { return show(use(v)); } catch (e) { return "threw " + e.name; } }
`;
  const roads: Record<string, string> = { entriesOfHeld: "holder.held.entries()", valuesOfHeld: "holder.held.values()" };
  const walks = ["fillByForOf", "spread", "spreadTwice", "arrayFrom", "arrayFromMapped", "firstTwo", "firstAndRest", "countByForOf", "keepOne", "keepLast", "newMap", "newSet", "fromEntries"];
  const walked = ["integers", "fractions", "texts", "records", "holes", "emptyList", "pairs", "map", "emptyMap", "set", "bytes", "doubles", "buffer", "params", "headers", "proxy"];
  for (const [r, road] of Object.entries(roads)) for (const u of walks) for (const a of ["integers", "map", "set", "bytes", "params", "headers"]) for (const b of walked) {
    if (a === b) continue;
    made.push({ name: `${u}-${a}-${b}-${r}`, file: "program.mjs", text: `${head.replace("return show(use(v));", "return show(ask(new Holder(v)));")}class Holder { constructor(held) { this.held = held; } }
function use(v) { ${uses[u]} }
function ask(holder) { return use(${road}); }
let last = "";
for (let n = 0; n < 1000; n++) last = attempt(${kinds[a]});
console.log(last);
for (let n = 0; n < 3; n++) console.log(attempt(${kinds[b]}));
console.log(attempt(${kinds[a]}));
` });
  }
  return made;
}
