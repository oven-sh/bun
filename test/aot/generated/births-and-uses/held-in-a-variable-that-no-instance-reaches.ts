// Objects that `new C` did not make, held in a variable of type C that no instance of C ever reaches: every birth, every kind of variable, every guard against null or undefined,
// every join with a value of a second class, and every use. TypeScript lets each birth through, and Object.create(C.prototype) is an everyday way to copy or revive an instance.
// What the compiler believes of a C or of a D may not decide what such a program does.
//
// A program is one class, one birth, one variable, one guard and one group of uses. Each join and each use has a function of its own in it.
export const oneIn = 300;

const classes: Record<string, string> = {
  empty: "class C {}",
  fields: 'class C { code = 1; ratio = 1.5; label = "x"; inner = { deep: 2 }; twice() { return this.code * 2; } get got() { return this.code; } }',
};
const second =
  'class D { code = 7; ratio = 2.5; label = "d"; inner = { deep: 3 }; a1 = 1; a2 = 2; a3 = 3; a4 = 4; a5 = 5; a6 = 6; far = "far"; twice() { return this.code * 3; } get got() { return this.code + 1; } }';

const births: Record<string, string> = {
  createPrototype: "Object.create(C.prototype)",
  createWithDescriptors: "Object.create(C.prototype, { extra: { value: 5, writable: true, enumerable: true, configurable: true } })",
  assigned: 'Object.assign(Object.create(C.prototype), { extra: 5, code: "text" })',
  copied: "Object.assign(Object.create(Object.getPrototypeOf(new C())), new C())",
  setPrototype: "Object.setPrototypeOf({ extra: 5 }, C.prototype)",
  literalProto: "{ __proto__: C.prototype, extra: 5 }",
  constructedObject: "Reflect.construct(Object, [], C)",
  constructedForSecond: "Reflect.construct(C, [], D)",
  constructedForFunction: "Reflect.construct(C, [], function () {})",
  returnsAnother: "new (class extends C { constructor() { super(); return { extra: 5 } as any; } })()",
  parentReturnsAnother: "new (class extends (class { constructor() { return Object.create(C.prototype); } }) { extra = 5; })()",
  parsedBelow: 'Object.setPrototypeOf(JSON.parse(`{"extra":5,"code":"text"}`), C.prototype)',
  parsed: 'JSON.parse(`{"extra":5,"ratio":"text"}`)',
  cloned: "structuredClone(new C())",
  proxied: "new Proxy(new C(), {})",
  proxiedBare: "new Proxy(Object.create(C.prototype), {})",
  literal: "{}",
  literalWith: '{ extra: 5, code: "text", far: 1 }',
  spread: "{ ...new C() }",
  below: "new (class extends C { extra = 5; })()",
  functionBelow: "Object.setPrototypeOf(function () {}, C.prototype)",
  arrayBelow: "Object.setPrototypeOf([1, 2], C.prototype)",
  ofSecond: "new D()",
  text: '"text"',
  honest: "new C()",
};

// How the variable is declared, how it is filled, and whether a function stands around everything, so that closures capture it.
const variables: Record<string, { declare: (birth: string) => string; fill: (birth: string) => string; isInFunction?: boolean }> = {
  moduleOrNull: { declare: () => "let held: C | null = null;", fill: b => `held = ${b} as any;` },
  moduleOrUndefined: { declare: () => "let held: C | undefined;", fill: b => `held = ${b} as any;` },
  moduleConstant: { declare: b => `const held: C = ${b} as any;`, fill: () => "" },
  moduleFilledByFunction: { declare: () => "let held: C | null = null;", fill: b => `function fill() { held = ${b} as any; }\nfill();` },
  capturedOrNull: { declare: () => "let held: C | null = null;", fill: b => `held = ${b} as any;`, isInFunction: true },
  capturedConstant: { declare: b => `const held: C = ${b} as any;`, fill: () => "", isInFunction: true },
};

// In front of these stands `const it = held;`.
const guards: Record<string, string> = {
  nothing: "",
  strictlyNull: 'if (it === null) return "none";',
  strictlyUndefined: 'if (it === undefined) return "none";',
  looselyNull: 'if (it == null) return "none";',
  truthy: 'if (!it) return "none";',
  instance: 'if (!(it instanceof C)) return "none";',
  hasName: 'if (!it || typeof it !== "object" || !("extra" in it)) return "none";',
  guard: 'if (!isThere(it)) return "none";',
  typeOf: 'if (typeof it !== "object" || it === null) return "none";',
};

// Gives `v`. `first` says which of the two is wanted.
const joins: Record<string, string> = {
  alone: "const v = it;",
  conditional: "const v: C | D = first ? it : others[0];",
  conditionalNew: "const v: C | D = first ? it : new D();",
  coalesced: "const v: C | D = (first ? it : null) ?? others[0];",
  loop: "let v: C | D = others[0]; for (let turn = first ? 0 : 1; turn < 1; turn++) v = it;",
  switched: "let v: C | D; switch (first ? 1 : 0) { case 1: v = it; break; default: v = others[0]; }",
  caught: "let v: C | D = others[0]; try { if (first) { v = it; throw 1; } } catch {}",
};

const groups: Record<string, Record<string, string>> = {
  readsThroughAny: {
    nowhere: "(v as any).nowhere", extra: "(v as any).extra", code: "(v as any).code", ratio: "(v as any).ratio + 1", label: "(v as any).label?.length", far: "(v as any).far",
    deep: "(v as any).inner?.deep", byKey: '(v as any)["co" + "de"]', optional: "(v as any)?.code", getter: "(v as any).got",
  },
  readsAsDeclared: {
    code: "v.code", ratio: "v.ratio + 1", label: "v.label.length", deep: "v.inner.deep", getter: "v.got", codeThenAny: "(v.code as any) + 1", innerThenAny: "(v.inner as any).deep",
    throughUnknown: "(v as unknown as { code: number }).code", missingThroughUnknown: "(v as unknown as { nowhere?: string }).nowhere",
  },
  callsAndTests: {
    callAny: "(v as any).twice()", callOptional: "(v as any).twice?.()", callDeclared: "v.twice()", has: '"code" in (v as any)', hasNot: '"nowhere" in (v as any)', isFirst: "v instanceof C", isSecond: "v instanceof D",
    keys: "Object.keys(v as any).join()", isNull: "(v as any) === null", isUndefined: "(v as any) === undefined", kind: "typeof (v as any)",
  },
  stores: {
    code: "((v as any).code = 9, (v as any).code)", ratio: "((v as any).ratio = 9.5, (v as any).ratio)", label: '((v as any).label = "new", (v as any).label)', far: '((v as any).far = "f", (v as any).far)',
    nowhere: "((v as any).nowhere = 1, (v as any).nowhere)", codeDeclared: "(v.code = 8, v.code)", ratioDeclared: "(v.ratio = 8.5, v.ratio)", labelDeclared: '(v.label = "newer", v.label)', innerDeclared: "(v.inner = { deep: 4 }, v.inner.deep)",
    removeCode: "delete (v as any).code", removeNowhere: "delete (v as any).nowhere",
  },
  handedOn: {
    returned: "(give(v) as any).code", returnedDeclared: "give(v).code", boxed: "(new Box(v).it as any).code", boxedDeclared: "new Box(v).it.ratio", listed: "([v] as (C | D)[])[0].code", taken: "take(v)", takenByAnyone: "(anyone.take as any)(v)",
    givenByAnyone: "(anyone.give as any)(v)?.code", kept: "(kept = v, (kept as any).code)",
  },
};

// The empty class declares none of the members.
const needsDeclaredMembers = /(\bv|give\(v\)|\.it|\[0\])\.(code|ratio|label|inner|got|twice)\b/;

const head = `function show(name: string, f: () => unknown) { try { const v = f(); console.log(name, typeof v, typeof v === "object" || typeof v === "function" ? String(v === null ? null : Object.keys(v as object)) : String(v)); } catch (e) { console.log(name, "threw", (e as Error)?.constructor?.name); } }
function describe(v: any) { try { return v === null || (typeof v !== "object" && typeof v !== "function") ? String(v) : JSON.stringify(Object.entries(Object.getOwnPropertyDescriptors(v)).map(([k, d]) => [k, typeof d.value, String(typeof d.value === "object" ? null : d.value)])); } catch (e) { return "threw"; } }
function isThere(v: unknown): v is C { return typeof v === "object" && v !== null; }
`;
const helpers = (read: string) => `const others: D[] = [new D()];
class Box { constructor(public it: C | D) {} }
function give(v: C | D): C | D { return v; }
function take(v: C | D): number { return ${read}; }
let kept: C | D | null = null;
const anyone: any = { take, give };
`;

export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  for (const [c, declaration] of Object.entries(classes))
    for (const [b, birth] of Object.entries(births))
      for (const [h, variable] of Object.entries(variables))
        for (const [t, guard] of Object.entries(guards))
          for (const [g, uses] of Object.entries(groups)) {
            if (c === "empty" && g === "readsAsDeclared") continue;
            made.push({
              name: `${c}-${b}-${h}-${t}-${g}`,
              file: "program.ts",
              get text() {
                const functions: string[] = [];
                const runs: string[] = [];
                for (const [m, join] of Object.entries(joins))
                  for (const [u, use] of Object.entries(uses)) {
                    if (c === "empty" && needsDeclaredMembers.test(use)) continue;
                    functions.push(`function ${m}_${u}(first: boolean) { const it = held; ${guard} ${join} return ${use}; }`);
                    runs.push(`show("${m} ${u}", () => ${m}_${u}(true)); show("${m} ${u} second", () => ${m}_${u}(false));`);
                  }
                const state = "console.log(describe(held), describe(others[0]), describe(kept));";
                const body = `${helpers(c === "empty" ? "(v as any).code" : "v.code")}${variable.declare(birth)}\n${functions.join("\n")}\n${variable.declare(birth).startsWith("const") ? "" : runs.join("\n") + "\n" + state + "\n"}${variable.fill(birth)}\n${runs.join("\n")}\n${state}\n`;
                return `${head}${declaration}\n${second}\n${variable.isInFunction ? `function main() {\n${body}}\nmain();\n` : body}`;
              },
            });
          }
  return made;
}
