// A table, no seeds: an object that nothing else holds is the source of a copy ({ ...make(), ...s }, Object.assign(target, make()), a rest pattern), and elsewhere in the file an object made in the same way reaches code that nobody follows.
//
//   how the object is made x how it is copied x what stands beside it x what is done to the copy x how an object of that making is opened
//
// One case to a program. What stands around the case looks at the copy in every way, typed and untyped.
type Named = { name: string; text: string };

const above = [
  "const never = process.argv.length > 99;",
  "const unseen = eval;",
  "type E = any;",
  "type K = E;",
  "let current: any, below: any, pending: any, notes: string[] = [];",
  "interface H { a: K; k: K; b: K; }",
].join("\n");
const below = [
  'const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };',
  'const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];',
  'const key: string = never ? "a" : "k";',
  'const words = ["zero", "one", "two"];',
  "function keep<T>(o: T): T { current = o; return o; }",
  "function show(x: unknown): string {",
  '    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);',
  "}",
  'function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }',
  "function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }",
  "const putter = { put(this: any, v: any) {",
  "} };",
  "function readK(o: H): unknown { return o.k; }",
  "function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }",
  "function typeK(o: H): string { return typeof o.k; }",
  "function inverseK(o: H): number { return 1 / (o.k as number); }",
  "function textK(o: H): string { return String(o.k); }",
  "function selfK(o: H): boolean { return o.k === o.k; }",
  'function switchK(o: H): string { switch (o.k) { case 0: return "zero"; case 1: return "one"; case 2: return "two"; case 7: return "seven"; case 2147483647: return "top"; case -2147483643: return "low"; default: return "other"; } }',
  "function indexK(o: H): unknown { return words[(o.k as number)]; }",
  'function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }',
  'function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }',
  'function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }',
  'function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }',
  "function copied(o: H): unknown { const c: H = { a: 7, k: 1, b: 9 }; c.k = o.k; return (c as any)[key]; }",
  "function spreadK(o: H): unknown { const c = { ...o }; return c.k; }",
  "function typedLooks(o: H, v: unknown): string {",
  "    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),",
  '        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");',
  "}",
  'function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }',
  "function untypedLooks(u: any, v: unknown): string {",
  "    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),",
  '        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),',
  '        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");',
  "}",
  "async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : 9, count = 1): Promise<void> {",
  "    for (let i = first; i < first + count; i++) {",
  "        const v = values[i]; current = undefined; below = undefined; notes = [];",
  '        let stored = "ok";',
  "        try { await f(v, i); } catch (e) { stored = failed(e); }",
  "        const o = current;",
  '        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));',
  "    }",
  "}",
].join("\n");

const stores = "function HF(this: H, k: K) { this.a = 7; this.k = k; this.b = 9; }";
const asAClass = "const HC = HF as unknown as new (k: K) => H;";
const bare = "function HF(this: H) {}";
const bareAsAClass = "const HC = HF as unknown as new () => H;";
const byNew = "function make(): H { return new HC(1); }";
const filledLater = "function make(): H { const o = new HC(); o.a = 7; o.k = 1; o.b = 9; return o; }";
const prototype = "const HP = { describe() { return 1; } };";

/** Each declares `make()`. */
const made: readonly Named[] = [
  { name: "a constructor function that stores", text: [stores, asAClass, byNew].join("\n") },
  { name: "a constructor function that stores nothing", text: [bare, bareAsAClass, filledLater].join("\n") },
  { name: "Object.create", text: [prototype, "function make(): H { const o = Object.create(HP); o.a = 7; o.k = 1; o.b = 9; return o; }"].join("\n") }, // prettier-ignore
  { name: "a literal with __proto__", text: [prototype, "function make(): H { return { __proto__: HP, a: 7, k: 1, b: 9 } as any; }"].join("\n") }, // prettier-ignore
  { name: "Object.setPrototypeOf", text: [prototype, "function make(): H { return Object.setPrototypeOf({ a: 7, k: 1, b: 9 }, HP); }"].join("\n") }, // prettier-ignore
  { name: "a literal", text: "function make(): H { return { a: 7, k: 1, b: 9 }; }" },
  { name: "a class with fields", text: ["class HF { a: K = 7; k: K; b: K = 9; constructor(k: K) { this.k = k; } }", "const HC = HF;", byNew].join("\n") }, // prettier-ignore
  { name: "a class below a class", text: ["class HB { a: K = 7; }", "class HF extends HB { k: K; b: K = 9; constructor(k: K) { super(); this.k = k; } }", "const HC = HF;", byNew].join("\n") }, // prettier-ignore
  { name: "Reflect.construct", text: [stores, asAClass, "function make(): H { return Reflect.construct(HC, [1]); }"].join("\n") }, // prettier-ignore
  { name: "a constructor function whose prototype may be replaced", text: [stores, "if (never) (HF as any).prototype = {};", asAClass, byNew].join("\n") }, // prettier-ignore
  { name: "a constructor function whose prototype is a literal", text: [stores, "(HF as any).prototype = { describe() { return 1; } };", asAClass, byNew].join("\n") }, // prettier-ignore
  { name: "a constructor function that calls another", text: ["function HB(this: H) { this.a = 7; }", "function HF(this: H, k: K) { (HB as any).call(this); this.k = k; this.b = 9; }", "(HF as any).prototype = Object.create((HB as any).prototype);", asAClass, byNew].join("\n") }, // prettier-ignore
  { name: "a constructor function that assigns", text: ["function HF(this: H, k: K) { Object.assign(this, { a: 7, k, b: 9 }); }", asAClass, byNew].join("\n") }, // prettier-ignore
  { name: "a bound constructor function", text: [stores, "const HC = (HF as any).bind(null) as new (k: K) => H;", byNew].join("\n") }, // prettier-ignore
];

/** `s` stands beside the object. */
const copied: readonly Named[] = [
  { name: "spread in front of another", text: "{ ...make(), ...s }" },
  { name: "spread behind another", text: "{ ...s, ...make() }" },
  { name: "spread alone", text: "{ ...make() }" },
  { name: "spread beside a member", text: "{ z: 1, ...make(), b: s.k }" },
  { name: "Object.assign onto the other", text: "Object.assign(s, make())" },
  { name: "Object.assign onto a new object", text: "Object.assign({}, make(), s)" },
  { name: "the rest of a parameter", text: "(({ ...rest }: any) => rest)(make())" },
  { name: "the rest of a pattern", text: "(() => { const { ...rest } = make(); return rest as H; })()" },
  {
    name: "the rest behind a member",
    text: "(() => { const { a, ...rest } = make() as any; return { a, ...rest }; })()",
  },
  { name: "its entries", text: "Object.fromEntries(Object.entries(make())) as any" },
  { name: "two of them spread", text: "{ ...make(), ...make() }" },
];

const beside: readonly Named[] = [
  { name: "a literal that is anything", text: "const s: any = { k: (-2147483644 as any) };" },
  { name: "parsed text", text: "const s: any = JSON.parse('{\"k\":-2147483644}');" },
  { name: "an object kept before", text: "const s: any = keep({ k: 5 });" },
  { name: "a literal of the type", text: "const s: H = { a: 1, k: 2, b: 3 };" },
];

const then: readonly Named[] = [
  { name: "it takes no more members", text: "Object.preventExtensions(o);" },
  { name: "nothing", text: "" },
];

/** `o` is an object of the same making. */
const opened: readonly Named[] = [
  { name: "the receiver of Reflect.set", text: 'Reflect.set({}, "k", (-2147483644 as any), o);' },
  { name: "text made at run time", text: 'unseen("o => o.k")(o);' },
  { name: "a key made at run time", text: "void (o as any)[key];" },
  { name: "Object.create", text: "below = Object.create(o);" },
  { name: "a for-in loop", text: "for (const name in o) notes.push(name);" },
  { name: "a member is defined", text: 'Object.defineProperty(o, "k", { value: 3 });' },
  { name: "a member is deleted", text: "delete (o as any).k;" },
  { name: "only kept", text: "" },
];

const crossed = made.flatMap(makes =>
  copied.flatMap(copies =>
    beside.flatMap(stands => then.flatMap(does => opened.map(opens => ({ makes, copies, stands, does, opens })))),
  ),
);

const laidOut = [[], ["--aot-erase-types"], ["--aot-heat=everything-is-hot"]];
export const programs = laidOut.length * crossed.length;

/** The flags that the program of that number is built with. */
export const flagsOf = (index: number): string[] => laidOut[Math.floor(index / crossed.length)];

export function programOf(index: number): { file: string; text: string } {
  // Neighbors in the table differ in how the object is opened alone: a stride that shares no factor with the length of the table takes a run's share from all over it.
  const { makes, copies, stands, does, opens } = crossed[((index % crossed.length) * 7919) % crossed.length];
  const label = `${makes.name} | ${copies.name} | ${stands.name} | ${does.name} | ${opens.name}`;
  return {
    file: "main.ts",
    text: `${above}
${makes.text}
${below}
await t(${JSON.stringify(label)}, () => { ${stands.text} const o: H = keep(${copies.text}); ${does.text} });
await t("an object of the same making", () => { const o = keep(make()); ${opens.text} });
export {};
`,
  };
}
