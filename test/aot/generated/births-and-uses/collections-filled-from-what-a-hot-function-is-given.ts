// A new collection is filled in a for-of over what a function is given. The function is hot with one kind of iterable, and is then given another: what it is hot with, against what comes then, against how
// the new collection is filled. The compiler plans the capacity of the new list from the size of what is walked, and a for-of over a value of several kinds is a switch on the kind: a size may be read
// only where the kind is known. In the second half the iterable is what entries(), keys() or values() of a member of the argument answers.
export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  const kinds: Record<string, string> = { // an expression that makes a fresh iterable
    mapEntries: 'new Map([["a", 1], ["b", 2], ["c", 3]]).entries()', mapKeys: 'new Map([["a", 1], ["b", 2]]).keys()', mapValues: 'new Map([["a", 1], ["b", 2]]).values()', map: 'new Map([["a", 1], ["b", 2], ["c", 3]])',
    set: "new Set([1, 2, 3, 4])", setValues: "new Set([1, 2]).values()", setEntries: "new Set([1, 2]).entries()",
    array: "[5, 6, 7]", arrayEntries: "[5, 6, 7].entries()", arrayValues: "[5, 6].values()", fractions: "[1.5, 2.5]", holes: "[1, , 3]",
    generator: "(function* () { yield 1; yield 2; })()", text: '"abc"', bytes: "new Uint8Array([1, 2, 3])", argumentsObject: "(function () { return arguments; })(1, 2, 3)",
    helper: "[1, 2, 3].values().map(each => each * 2)", own: "{ [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i >= 2, value: i++ }) }; } }",
    emptyMap: "new Map().entries()", emptyArray: "[]", largeMap: "new Map(Array.from({ length: 100 }, (_, i) => [i, i])).entries()", largeArray: "Array.from({ length: 100 }, (_, i) => i)",
  };
  const fillers: Record<string, string> = {
    push: "const result = []; for (const value of given) result.push(value); return result;",
    pushWhere: "const result = []; for (const value of given) if (value !== 2) result.push(value); return result;",
    byIndex: "const result = []; let at = 0; for (const value of given) result[at++] = value; return result;",
    twoLists: "const result = [], texts = []; for (const value of given) { result.push(value); texts.push(String(value)); } return [result, texts];",
    intoAMap: "const result = new Map(); for (const value of given) result.set(String(value), value); return result;",
    intoASet: "const result = new Set(); for (const value of given) result.add(String(value)); return result;",
    pushTwice: "const result = []; for (const value of given) result.push(value, value); return result;",
  };
  const head = `function show(r) { return r instanceof Map ? "Map " + r.size + " " + JSON.stringify([...r]) : r instanceof Set ? "Set " + r.size + " " + JSON.stringify([...r]) : r.length + " " + JSON.stringify(r); }\n`;
  const run = (first: string, second: string, call: (made: string) => string) => `let last = "";
for (let n = 0; n < 1000; n++) last = show(${call(first)});
console.log(last);
for (let n = 0; n < 3; n++) { try { last = show(${call(second)}); } catch (e) { last = "threw " + e.name; } console.log(last); }
console.log(show(${call(first)}));
`;
  for (const [f, filler] of Object.entries(fillers)) for (const [a, first] of Object.entries(kinds)) for (const [b, second] of Object.entries(kinds)) {
    if (a === b || (f !== "push" && !/^(mapEntries|map|set|array|generator|largeMap)$/.test(a))) continue; // every pair for push; six first kinds for the other fillers
    made.push({ name: `${f}-${a}-${b}`, file: "program.mjs", text: head + `function fill(given) { ${filler} }\n` + run(first, second, x => `fill(${x})`) });
  }
  // the iterable is asked of a member of what is given, as in the witness
  const holders: Record<string, string> = { map: 'new Map([["a", 1], ["b", 2]])', set: "new Set([1, 2, 3, 4])", array: "[5, 6, 7]", bytes: "new Uint8Array([1, 2])", params: 'new URLSearchParams("a=1&b=2")', headers: 'new Headers({ a: "1" })', form: "new FormData()" };
  for (const method of ["entries", "keys", "values"]) for (const f of ["push", "intoAMap", "byIndex"]) for (const [a, first] of Object.entries(holders)) for (const [b, second] of Object.entries(holders)) {
    if (a === b) continue;
    made.push({ name: `${f}-${method}Of-${a}-${b}`, file: "program.mjs", text: head + `function fill(given) { ${fillers[f]} }\nclass Holder { constructor(held) { this.held = held; } }\nfunction ask(holder) { return fill(holder.held.${method}()); }\n` + run(first, second, x => `ask(new Holder(${x}))`) });
  }
  return made;
}
