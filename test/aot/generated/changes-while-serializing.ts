// JSON.stringify lists the keys of an object once, reads the length of an array once, and reads every value when its turn comes. What a compiled serializer has tested about the holder holds only as long as no code of the program runs.
// Each case puts one value into the holder that runs code of the program while it is written, and that code changes the holder behind the place that is being written.
// The table: the holder x the value that runs code, a replacer or an indentation x the change.
//
//   bun changes-while-serializing.ts <folder> [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/serialize-<holder>.ts.
import { writeCaseFiles, type CaseFile } from "./case-files";

interface Named {
  name: string;
  text: string;
}

/** Each gets `change` called while it is written. */
const carriers: Named[] = [
  { name: "to-json", text: "{ toJSON() { change(); return 5; } }" },
  { name: "to-json-with-its-key", text: "{ toJSON(k: string) { change(); return k; } }" },
  { name: "to-json-above", text: "Object.create({ toJSON() { change(); return 5; } })" },
  { name: "to-json-answers-an-object", text: "{ toJSON() { change(); return { q: 1 }; } }" },
  { name: "getter", text: "{ get p() { change(); return 1; } }" },
  { name: "getter-second", text: "{ o: 0, get p() { change(); return 1; }, q: 2 }" },
  { name: "date-own-to-iso-string", text: `Object.assign(new Date(0), { toISOString() { change(); return "iso"; } })` },
  { name: "date-own-to-json", text: `Object.assign(new Date(0), { toJSON() { change(); return "own"; } })` },
  { name: "date-own-value-of", text: "Object.assign(new Date(0), { valueOf() { change(); return 0; } })" },
  { name: "date-own-to-primitive", text: "Object.defineProperty(new Date(0), Symbol.toPrimitive, { value() { change(); return 0; } })" },
  { name: "date-subclass", text: `new (class extends Date { toISOString() { change(); return "sub"; } })(0)` },
  { name: "date-plain", text: "(change(), new Date(0))" },
  { name: "date-invalid", text: "(change(), new Date(NaN))" },
  { name: "text-object", text: `Object.assign(new String("s"), { toString() { change(); return "t"; } })` },
  { name: "number-object", text: "Object.assign(new Number(1), { valueOf() { change(); return 2; } })" },
  { name: "big-integer-object", text: "Object.assign(Object(1n), { toJSON() { change(); return 1; } })" },
  { name: "proxy-keys", text: "new Proxy({ p: 1 }, { ownKeys(o) { change(); return Reflect.ownKeys(o); } })" },
  { name: "proxy-get", text: "new Proxy({ p: 1 }, { get(o, k, r) { change(); return Reflect.get(o, k, r); } })" },
  { name: "proxy-of-a-list", text: `new Proxy([1, 2], { get(o, k, r) { if (k === "length") change(); return Reflect.get(o, k, r); } })` },
  { name: "list-with-a-getter", text: "Object.defineProperty([0, 1], 0, { get() { change(); return 7; }, enumerable: true })" },
  { name: "list-with-to-json-inside", text: "[0, { toJSON() { change(); return 5; } }, 2]" },
  { name: "deep", text: "{ one: { two: { three: { toJSON() { change(); return 5; } } } } }" },
  { name: "instance-with-to-json", text: "new (class { v = 1; toJSON() { change(); return this.v; } })()" },
  { name: "function-with-to-json", text: "Object.assign(() => 1, { toJSON() { change(); return 5; } })" },
  { name: "long-text-from-to-json", text: `{ toJSON() { change(); return "x".repeat(5000); } }` },
  { name: "wide-text-from-to-json", text: '{ toJSON() { change(); return "\\u4e2d".repeat(40); } }' },
  { name: "throws", text: `{ toJSON() { change(); throw new RangeError("stop"); } }` },
];

/** `h` is the holder. */
const objectChanges: Named[] = [
  { name: "delete-a-later-name", text: "delete h.c;" },
  { name: "delete-an-earlier-name", text: "delete h.a;" },
  { name: "add-a-name", text: "h.z = 9;" },
  { name: "store-the-same-type", text: "h.c = 4;" },
  { name: "store-another-type", text: `h.c = "text";` },
  { name: "store-an-object", text: "h.c = { deep: [1] };" },
  { name: "later-name-becomes-a-getter", text: `Object.defineProperty(h, "c", { get() { return "got"; }, enumerable: true });` },
  { name: "later-name-is-hidden", text: `Object.defineProperty(h, "c", { enumerable: false });` },
  { name: "delete-and-add-again", text: "delete h.b; h.b = 8;" },
  { name: "reparent-with-to-json", text: `Object.setPrototypeOf(h, { toJSON() { return "late"; } });` },
  { name: "freeze", text: "Object.freeze(h);" },
];

const listChanges: Named[] = [
  { name: "shorter", text: "h.length = 2;" },
  { name: "longer", text: "h.push(9);" },
  { name: "store-the-same-type", text: "h[3] = 4;" },
  { name: "store-another-type", text: `h[3] = "text";` },
  { name: "store-a-fraction", text: "h[3] = 0.5;" },
  { name: "store-an-object", text: "h[3] = { deep: [1] };" },
  { name: "a-hole", text: "delete h[3];" },
  { name: "far-away", text: "h[100] = 1;" },
  { name: "pop-twice", text: "h.pop(); h.pop();" },
  { name: "later-element-becomes-a-getter", text: `Object.defineProperty(h, 3, { get() { return "got"; }, enumerable: true });` },
  { name: "a-name-on-the-list", text: "h.extra = 1;" },
];

/** Each puts `carrier` into `made`, which is serialized, and stores the holder in `h`. */
const holders: { name: string; make: string; changes: Named[] }[] = [
  { name: "class", make: `class Box { a = 1; carrier: unknown; b = "two"; c: unknown = 3; constructor(x: unknown) { this.carrier = x; } } const made = new Box(carrier); h = made;`, changes: objectChanges },
  { name: "literal", make: `const made: { a: number; carrier: unknown; b: string; c: unknown } = { a: 1, carrier, b: "two", c: 3 }; h = made;`, changes: objectChanges },
  { name: "nested", make: `const made = { first: 0, inner: { a: 1, carrier, b: "two", c: 3 as unknown }, last: 9 }; h = made.inner;`, changes: objectChanges },
  { name: "outer-of-nested", make: `const made = { a: 1, inner: { carrier }, b: "two", c: 3 as unknown }; h = made;`, changes: objectChanges },
  { name: "list", make: `const made: unknown[] = [1, carrier, "two", 3, 4]; h = made;`, changes: listChanges },
  { name: "list-of-numbers-but-one", make: "const made: unknown[] = [1, carrier, 2, 3, 4]; h = made;", changes: listChanges },
  { name: "list-in-an-object", make: `const made = { before: 0, items: [1, carrier, "two", 3, 4] as unknown[], after: 9 }; h = made.items;`, changes: listChanges },
  { name: "list-of-objects", make: "class Item { n: unknown; constructor(n: unknown) { this.n = n; } } const made = [new Item(1), new Item(carrier), new Item(2), new Item(3), new Item(4)]; h = made;", changes: listChanges },
  { name: "object-in-a-list", make: `const inner = { a: 1, carrier, b: "two", c: 3 as unknown }; const made = [0, inner, 9]; h = inner;`, changes: objectChanges },
];

const head = `// While JSON.stringify writes an object or a list, a value in it runs program code that changes what has not been written yet.
declare const console: { log(...values: unknown[]): void };
function t(name: string, f: () => unknown) { let r; try { r = f(); } catch (e) { r = "threw " + (e as Error).name; } console.log(name, r); }
`;

export const caseFiles = (): CaseFile[] =>
  holders.map(holder => {
    const caseOf = (way: string, change: Named, carrier: string, rest: string) => {
      const name = `${holder.name} ${way} ${change.name}`;
      return { name, line: `t("${name}", () => { let h: any, ran = 0; const change = () => { if (ran++ || !h) return; ${change.text} }; const carrier: unknown = ${carrier}; ${holder.make} ${rest} });` };
    };
    return {
      name: `serialize-${holder.name}.ts`,
      head,
      cases: [
        ...carriers.flatMap(carrier => holder.changes.map(change => caseOf(carrier.name, change, carrier.text, `ran = 0; const first = JSON.stringify(made); return first + " " + JSON.stringify(made) + " " + ran;`))),
        ...holder.changes.flatMap(change => [
          caseOf("replacer", change, "5", `return JSON.stringify(made, (k, v) => { if (v === 5) change(); return v; }) + " " + JSON.stringify(made);`),
          caseOf("indented", change, "{ toJSON() { change(); return 5; } }", `return JSON.stringify(made, null, 1) + " " + JSON.stringify(made, null, "\\t");`),
        ]),
      ],
    };
  });

if (import.meta.main) writeCaseFiles(caseFiles());
