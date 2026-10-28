// The pairs that Object.entries, a Map or the entries of an array hand out, one way of changing each pair, and two patterns that take the pairs apart afterwards.
export const makers: Record<string, string> = {
  "Object.entries": `const entries = Object.entries({ alpha: 1, beta: 2 });`,
  "the entries of a Map, spread": `const entries = [...new Map([["alpha", 1], ["beta", 2]]).entries()];`,
  "Array.from of a Map": `const entries = Array.from(new Map([["alpha", 1], ["beta", 2]]));`,
  "the entries of an array": `const entries = [...["x", "y"].entries()].map(e => e);`,
};

export const changes: Record<string, string> = {
  "reverse": `for (const e of entries) e.reverse();`,
  "sort": `for (const e of entries) e.sort((a, b) => (typeof a === "number" ? -1 : 1));`,
  "fill with a number": `for (const e of entries) e.fill(7);`,
  "fill with an object": `for (const e of entries) e.fill({ length: "L" });`,
  "copyWithin": `for (const e of entries) e.copyWithin(0, 1);`,
  "splice that removes": `for (const e of entries) e.splice(0, 1);`,
  "splice that inserts": `for (const e of entries) e.splice(0, 0, 9);`,
  "splice with the elements of a typed array": `for (const e of entries) e.splice(0, 2, ...new Uint8Array([1, 2]));`,
  "shift": `for (const e of entries) e.shift();`,
  "unshift": `for (const e of entries) e.unshift(3.5);`,
  "pop": `for (const e of entries) e.pop();`,
  "pop twice and push": `for (const e of entries) { const v = e.pop(), k = e.pop(); e.push(v, k); }`,
  "length set to zero": `for (const e of entries) e.length = 0;`,
  "reverse by call": `for (const e of entries) Array.prototype.reverse.call(e);`,
  "reverse by Reflect.apply": `for (const e of entries) Reflect.apply(Array.prototype.reverse, e, []);`,
  "reverse bound": `for (const e of entries) Array.prototype.reverse.bind(e)();`,
  "a swap by a pattern": `for (const e of entries) [e[0], e[1]] = [e[1], e[0]];`,
  "Object.assign": `for (const e of entries) Object.assign(e, [5, "five"]);`,
  "Object.defineProperty with a value": `for (const e of entries) Object.defineProperty(e, 0, { value: 5 });`,
  "Object.defineProperty with a getter": `for (const e of entries) Object.defineProperty(e, "0", { get() { return 5; } });`,
  "Reflect.set": `for (const e of entries) Reflect.set(e, 0, 5);`,
  "delete": `for (const e of entries) delete e[0];`,
  "reverse in forEach": `entries.forEach(e => e.reverse());`,
  "reverse in map": `entries.map(e => e.reverse());`,
  "reverse behind flatMap": `for (const e of entries.flatMap(e => [e])) e.reverse();`,
  "reverse of what find answers": `entries.find(e => true).reverse();`,
  "reverse of what at answers": `entries.at(0).reverse(); entries.at(-1).reverse();`,
  "reverse of what an index answers": `entries[0].reverse(); entries[1].reverse();`,
  "reverse in the comparator of the outer sort": `entries.sort((a, b) => { a.reverse(); return 0; });`,
  "reverse in the replacer of JSON.stringify": `JSON.stringify(entries, function (k, v) { if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string") v.reverse(); return v; });`,
  "reverse in toString": "for (const e of entries) { e.toString = function () { this.reverse(); return \"\"; }; `${e}`; }",
  "an iterator method of its own": `for (const e of entries) e[Symbol.iterator] = function* () { yield 5; yield "five"; };`,
  "another prototype with an iterator method": `for (const e of entries) Object.setPrototypeOf(e, { [Symbol.iterator]: function* () { yield 5; yield "five"; } });`,
};

const tail = `
function show(k, v) { let a; try { a = String(k.length) + ":" + String(k.charCodeAt ? k.charCodeAt(0) : "none"); } catch (e) { a = "throws " + e.name; } return typeof k + ":" + String(k) + ":" + a + " | " + typeof v + ":" + String(v) + ":" + String(v + 1); }
for (const [k, v] of entries) console.log(show(k, v));
for (const e of entries) { const [k, v] = e; console.log(show(k, v)); }
`;

export const textOf = (maker: string, change: string) => `${makers[maker]}\n${changes[change]}${tail}`;
