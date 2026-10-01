// Group 11: emitDecoratorMetadata. Every type form of group 01 (and the object types of group 02)
// stands in a decorated property type, in a parameter type of a decorated method and in its
// return type. More positions follow for a core subset and for the conditions that decide
// whether a type is read for metadata at all.
//
// run.mjs keeps the output of Bun (experimentalDecorators + emitDecoratorMetadata) and the output
// of ts.transpileModule twice: "loose" (strict: false, strictNullChecks: false) and "strict"
// (the defaults of tsc 6.0.2). metadata.mjs compares them.
import { forms } from "./01-type-forms.mjs";
import { objectForms } from "./02-object-types.mjs";

const SINK = "src/js_parser/parse/type_sink.rs";
const G = "src/js_parser/parse/parse_skip_typescript.rs";

export const families = {
  form: { bun: `${SINK}:163-348 DecoratorMetadata, ${G}:243-810, src/ast/ts.rs:179-299 (merge rules), src/js_parser/p.rs:7901-8060 serialize_metadata`, ref: `_submodules/TypeScript/src/compiler/transformers/typeSerializer.ts serializeTypeNode, serializeUnionOrIntersectionConstituents` },
  position: { bun: `src/js_parser/parse/parse_fn.rs:286-303 (parameter), 370-393 (return type), src/js_parser/parse/parse_property.rs:663-676 (property), src/js_parser/p.rs:7686-7724 (constructor), 7763-7899 (members)`, ref: `_submodules/TypeScript/src/compiler/transformers/legacyDecorators.ts, typeSerializer.ts serializeTypeOfNode, serializeParameterTypesOfNode, serializeReturnTypeOfNode` },
};

export const POSITIONS = {
  prop: T => `class C { @d p: ${T}; }`,
  param: T => `class C { @d m(a: ${T}) {} }`,
  ret: T => `class C { @d m(): ${T} { throw 0 } }`,
};

export const MORE_POSITIONS = {
  staticProp: T => `class C { @d static p: ${T}; }`,
  propInit: T => `class C { @d p: ${T} = x; }`,
  optionalProp: T => `class C { @d p?: ${T}; }`,
  definiteProp: T => `class C { @d p!: ${T}; }`,
  declareProp: T => `class C { @d declare p: ${T}; }`,
  abstractProp: T => `abstract class C { @d abstract p: ${T}; }`,
  staticMethodParam: T => `class C { @d static m(a: ${T}) {} }`,
  secondParam: T => `class C { @d m(a: string, b: ${T}) {} }`,
  optionalParam: T => `class C { @d m(a?: ${T}) {} }`,
  defaultParam: T => `class C { @d m(a: ${T} = x) {} }`,
  restParam: T => `class C { @d m(...a: ${T}) {} }`,
  restArrayParam: T => `class C { @d m(...a: ${T}[]) {} }`,
  thisParam: T => `class C { @d m(this: ${T}, b: string) {} }`,
  paramDecorated: T => `class C { m(@d a: ${T}) {} }`,
  paramDecoratedRet: T => `class C { m(@d a: string): ${T} { throw 0 } }`,
  paramBeforeDecorated: T => `class C { m(a: ${T}, @d b: string) {} }`,
  paramAfterDecorated: T => `class C { m(@d a: string, b: ${T}) {} }`,
  ctorParam: T => `@d class C { constructor(a: ${T}) {} }`,
  ctorParamProp: T => `@d class C { constructor(public a: ${T}) {} }`,
  ctorParamDecorated: T => `class C { constructor(@d a: ${T}) {} }`,
  ctorParamBeforeDecorated: T => `class C { constructor(a: ${T}, @d b: string) {} }`,
  getter: T => `class C { @d get p(): ${T} { throw 0 } }`,
  setter: T => `class C { @d set p(v: ${T}) {} }`,
  getterSetter: T => `class C { @d get p(): ${T} { throw 0 } set p(v: ${T}) {} }`,
  asyncRet: T => `class C { @d async m(): ${T} { throw 0 } }`,
  generatorRet: T => `class C { @d *m(): ${T} { throw 0 } }`,
  overloadRet: T => `class C { m(): ${T}; @d m(): any { throw 0 } }`,
  genericMethod: T => `class C { @d m<U>(a: ${T}): ${T} { throw 0 } }`,
  classExprProp: T => `const c = class { @d p: ${T}; };`,
  exportedClassProp: T => `export class C { @d p: ${T}; }`,
  decoratorCall: T => `class C { @d() @e.f(1) p: ${T}; }`,
};

const plain = [
  "class C { @d p; }", "class C { @d p = 1; }", "class C { @d p = \"s\"; }", "class C { @d p?; }", "class C { @d p!; }", "class C { @d static p; }", "class C { @d m() {} }", "class C { @d m(a) {} }", "class C { @d m(a, b) {} }", "class C { @d m(a = 1) {} }", "class C { @d m(...a) {} }", "class C { @d m({ a }) {} }", "class C { @d m([a]) {} }", "class C { @d m({ a }: A, [b]: B) {} }", "class C { @d async m() {} }", "class C { @d *m() {} }", "class C { @d async *m() {} }", "class C { @d static m() {} }", "class C { @d get p() { return 1 } }", "class C { @d set p(v) {} }", "class C { @d get p() { return 1 } @d set p(v) {} }", "class C { get p(): string { throw 0 } @d set p(v: string) {} }", "class C { @d get p(): string { throw 0 } set p(v: number) {} }", "class C { @d set p(v: number) {} get p(): string { throw 0 } }",
  "@d class C {}", "@d class C { constructor() {} }", "@d class C { constructor(a) {} }", "@d class C { constructor(a, b: string) {} }", "@d class C extends B {}", "@d class C extends B { constructor(a: string) { super() } }", "@d class C { constructor(a: string); constructor(a: any) {} }", "@d class C { constructor(a: string); constructor(a: number); constructor(a: any, b?: boolean) {} }", "@d class C { constructor(private a: string, protected b: number, readonly c: boolean, public d?: C) {} }", "@d class C { m(a: string) {} }", "@d class C { p: string; }", "@d class C { static m(a: string): number { throw 0 } }", "@d export class C { constructor(a: string) {} }", "@d export default class C { constructor(a: string) {} }", "@d export default class { constructor(a: string) {} }", "@d abstract class C { constructor(a: string) {} }", "const c = @d class { constructor(a: string) {} };", "@d class C { constructor(@e a: string, b: number) {} }", "class C { constructor(a: string, @e b: number) {} }", "class C { constructor(@e a: string, b: number) {} }", "class C { m(a: string, @e b: number): boolean { throw 0 } }", "class C { m(@e a: string, b: number): boolean { throw 0 } }", "class C { @d m(a: string, @e b: number): boolean { throw 0 } }", "class C { static m(a: string, @e b: number): boolean { throw 0 } }", "class C { m(a: string, b: number, @e c: boolean) {} }", "class C { m(@e a: string) {} n(b: number) {} }", "class C { m(@e a: string) {} @d n(b: number) {} }", "class C { n(b: number) {} m(@e a: string) {} }", "class C { constructor(a: string) {} m(@e b: number) {} }", "class C { m(@e b: number) {} constructor(a: string) {} }", "@d class C { m(@e b: number) {} constructor(a: string) {} }", "class C { set p(@e v: string) {} }", "class C { async m(@e a: string) {} }", "class C { m(@e a: string) {} }", "class C { m(@e a) {} }", "class C { m(@e ...a: string[]) {} }", "class C { m(@e a?: string) {} }", "class C { m(@e a: string = \"s\") {} }", "class C { m(this: C, @e a: string) {} }", "class C { m(@e { a }: A) {} }",
  "class K {} class C { @d p: K; }", "class C { @d p: K; } class K {}", "class C { @d p: C; }", "interface I {} class C { @d p: I; }", "type T = string; class C { @d p: T; }", "enum E { A } class C { @d p: E; }", "enum E { A = \"a\" } class C { @d p: E; }", "const enum E { A } class C { @d p: E; }", "enum E { A } class C { @d p: E.A; }", "namespace N { export class K {} } class C { @d p: N.K; }", "namespace N { export interface I {} } class C { @d p: N.I; }", "declare class K {} class C { @d p: K; }", "declare const K: any; class C { @d p: typeof K; }", "function K() {} class C { @d p: K; }", "const K = 1; class C { @d p: K; }", "let K; class C { @d p: K; }", "import K from \"k\"; class C { @d p: K; }", "import { K } from \"k\"; class C { @d p: K; }", "import * as K from \"k\"; class C { @d p: K.L; }", "import type K from \"k\"; class C { @d p: K; }", "import type { K } from \"k\"; class C { @d p: K; }", "import { type K } from \"k\"; class C { @d p: K; }", "import type * as K from \"k\"; class C { @d p: K.L; }", "import K = require(\"k\"); class C { @d p: K; }", "import K = N.L; class C { @d p: K; }", "import { K } from \"k\"; class C { @d m(a: K): K { throw 0 } }", "import { K } from \"k\"; @d class C { constructor(a: K) {} }", "import { K, L } from \"k\"; class C { @d p: K | L; }", "import { K } from \"k\"; class C { @d p: K | null; }", "import { K } from \"k\"; class C { @d p: K.L; }", "import { K } from \"k\"; class C { @d p: K<string>; }", "import { K } from \"k\"; class C { @d p: K[]; }", "class C<T> { @d p: T; }", "class C<T> { @d m(a: T): T { throw 0 } }", "class C { @d m<T>(a: T): T { throw 0 } }", "class C<T extends string> { @d p: T; }", "class C { @d p: Array<string>; }", "class C { @d p: Promise<string>; }", "class C { @d p: Map<string, number>; }", "class C { @d p: Date; }", "class C { @d p: RegExp; }", "class C { @d p: Function; }", "class C { @d p: Object; }", "class C { @d p: String; }", "class C { @d p: Number; }", "class C { @d p: Boolean; }", "class C { @d p: Symbol; }", "class C { @d p: BigInt; }", "class C { @d p: Array; }", "class C { @d p: Promise; }", "class C { @d p: Object | string; }", "class C { @d p: string | Object; }", "class C { @d p: Object & string; }", "class C { @d p: globalThis.Date; }", "class C { @d p: a.b.c.d.e; }", "class C { @d p: a.b<string>; }", "class C { @d async m(): Promise<string> { throw 0 } }", "class C { @d async m(): Promise<void> {} }", "class C { @d async m(): P { throw 0 } }", "class C { @d async m(): string { throw 0 } }",
];

const seen = new Set();
const allForms = [];
for (const [fam, list] of Object.entries(forms)) {
  for (const form of list) {
    if (seen.has(form)) continue;
    seen.add(form);
    allForms.push([fam, form]);
  }
}
for (const M of objectForms.members) {
  const form = `{ ${M} }`;
  if (!seen.has(form)) (seen.add(form), allForms.push(["object", form]));
}
for (const M of objectForms.mapped) {
  const form = `{ ${M} }`;
  if (!seen.has(form)) (seen.add(form), allForms.push(["mapped", form]));
}

const mergeAtoms = ["string", "number", "boolean", "bigint", "symbol", "any", "unknown", "never", "void", "null", "undefined", "object", "A", "B", "Object", "\"s\"", "1", "true", "A[]", "[A]", "() => void", "{ a: A }", "keyof A", "typeof a", "A.B", "A<B>", "`a${A}`", "this", "(string)", "(A | null)"];
const merges = [];
for (const a of mergeAtoms) {
  for (const b of mergeAtoms) {
    merges.push(`${a} | ${b}`, `${a} & ${b}`, `X extends Y ? ${a} : ${b}`);
  }
}
const shape = [];
for (const [c, t, f] of [["A", "string", "string"], ["A", "string", "number"], ["A", "string", "never"], ["A", "never", "string"], ["A", "K", "K"], ["A", "K", "L"], ["A", "K", "null"], ["A", "null", "K"], ["A", "K", "undefined"], ["A", "any", "string"], ["A", "string", "any"], ["A", "unknown", "string"], ["A", "string", "unknown"], ["A", "void", "string"], ["A", "string[]", "number[]"], ["A", "() => void", "() => void"], ["A", "{}", "{}"], ["A", "Object", "string"]]) {
  shape.push(
    `${c} extends B ? ${t} : ${f}`,
    `string | ${c} extends B ? ${t} : ${f}`,
    `number | ${c} extends B ? ${t} : ${f}`,
    `K | ${c} extends B ? ${t} : ${f}`,
    `string & ${c} extends B ? ${t} : ${f}`,
    `K & ${c} extends B ? ${t} : ${f}`,
    `keyof ${c} extends B ? ${t} : ${f}`,
    `readonly ${c}[] extends B ? ${t} : ${f}`,
    `unique symbol extends B ? ${t} : ${f}`,
    `${c}[] extends B ? ${t} : ${f}`,
    `typeof a extends B ? ${t} : ${f}`,
    `(${c} extends B ? ${t} : ${f})`,
    `(${c} extends B ? ${t} : ${f})[]`,
    `${c} extends B ? ${t} : ${f} | string`,
    `${c} extends B ? ${t} : ${f} | number`,
    `${c} extends B ? ${t} : ${f} | K`,
    `${c} extends B ? ${t} : ${f} & string`,
    `${c} extends B ? ${t} : ${f} & K`,
    `${c} extends B ? ${t} : ${f} | null`,
    `${c} extends B ? ${t} | string : ${f}`,
    `${c} extends B ? ${t} & K : ${f}`,
    `${c} extends B ? ${t} : X extends Y ? ${t} : ${f}`,
    `${c} extends B ? X extends Y ? ${t} : ${f} : ${f}`,
    `${c} extends B ? ${t} : ${f}[]`,
    `${c} extends B ? ${t} : keyof ${f}`,
    `${c} extends B ? ${t} : readonly ${f}[]`,
    `${c} extends B ? (${t}) : (${f})`,
    `${c} extends infer U ? ${t} : ${f}`,
    `${c} extends infer U extends V ? ${t} : ${f}`,
    `string | (${c} extends B ? ${t} : ${f})`,
    `(string | ${c}) extends B ? ${t} : ${f}`,
  );
}
const predicates = ["a is string", "a is K", "this is K", "asserts a", "asserts a is string", "asserts this", "asserts this is K", "a is string | number", "a is K extends B ? C : D", "asserts a is K | null", "a is", "asserts", "asserts a is"];

for (const f of [...merges, ...shape]) if (!seen.has(f)) (seen.add(f), allForms.push(["merge", f]));
for (const f of predicates) if (!seen.has(f)) (seen.add(f), allForms.push(["pred", f]));

const cases = [];
for (const [fam, form] of allForms) {
  for (const [pos, make] of Object.entries(POSITIONS)) {
    cases.push({ fam: "form", form, ctx: pos, note: fam, src: `${make(form)}` });
  }
}
const coreForms = [...forms.core, ...predicates, "string", "number", "K", "K | null", "K | undefined", "string | null", "string[]", "K[]", "Array<K>", "Promise<K>", "A | B extends C ? string : string", "keyof A extends B ? string : string", "A extends B ? string : never", "A extends B ? string : string"];
const coreSeen = new Set();
for (const form of coreForms) {
  if (coreSeen.has(form)) continue;
  coreSeen.add(form);
  for (const [pos, make] of Object.entries(MORE_POSITIONS)) {
    cases.push({ fam: "position", form, ctx: pos, src: make(form) });
  }
}
for (const src of plain) cases.push({ fam: "position", src, ctx: "plain" });

export default { name: "emitDecoratorMetadata", families, cases, programs: [], metadata: true, keepOutput: "ts.deco" };
