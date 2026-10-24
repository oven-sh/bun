// Classes, object types, enums and namespaces with more and more members, around the number of properties that a layout of the compiler holds. Past it the program is slower. It prints the same.
import { generated } from "./generated/run-generated";
import { tsconfig } from "./generated/typed-object-mutations";

const many = (count: number, each: (at: number) => string, between = "\n") =>
  Array.from({ length: count }, (_, at) => each(at)).join(between);

const forms: Record<string, { file: string; refusedFrom?: number; text: (count: number) => string }> = {
  "public fields": {
    file: "main.js",
    text: n => `class C {\n${many(n, i => `p${i} = ${i};`)}\nsum() { return this.p0 + this.p${n - 1} + this.p${n >> 1}; } }
const c = new C; c.p${n - 1} = 7; console.log(c.sum(), Object.keys(c).length, Object.keys(c)[${n - 1}]);`,
  },
  "declared fields": {
    file: "main.ts",
    text: n => `class C {\n${many(n, i => `p${i}: number = ${i};`)}\nsum(): number { return this.p0 + this.p${n - 1} + this.p${n >> 1}; } }
const c = new C; c.p${n - 1} = 7; console.log(c.sum(), Object.keys(c).length, Object.keys(c)[${n - 1}]);`,
  },
  "private fields": {
    file: "main.js",
    refusedFrom: 4095,
    text: n => `class C {\n${many(n, i => `#p${i} = ${i};`)}\nsum() { return this.#p0 + this.#p${n - 1} + this.#p${n >> 1}; } set(v) { this.#p${n - 1} = v; } }
const c = new C; c.set(7); console.log(c.sum(), Object.keys(c).length);`,
  },
  "accessor fields": {
    file: "main.ts",
    refusedFrom: 4095,
    text: n => `class C {\n${many(n, i => `accessor p${i}: number = ${i};`)}\n}
const c = new C; c.p${n - 1} = 7; console.log(c.p0 + c.p${n - 1} + c.p${n >> 1}, Object.keys(c).length);`,
  },
  "public fields of a class and private fields of its heir": {
    file: "main.js",
    text: n => `class A {\n${many(n >> 1, i => `a${i} = ${i};`)}\n}
class B extends A {\n${many(n - (n >> 1), i => `#b${i} = ${i};`)}\nlast() { return this.#b${n - (n >> 1) - 1} + this.a0; } }
const c = new B; console.log(c.last(), Object.keys(c).length);`,
  },
  "public fields of a class and of its heir": {
    file: "main.js",
    text: n => `class A {\n${many(n >> 1, i => `a${i} = ${i};`)}\n}
class B extends A {\n${many(n - (n >> 1), i => `b${i} = ${i};`)}\n}
const c = new B; c.b0 = 7; console.log(c.a0 + c.b0 + c.b${n - (n >> 1) - 1}, Object.keys(c).length);`,
  },
  "declared fields of a class and of its heir": {
    file: "main.ts",
    text: n => `class A {\n${many(n >> 1, i => `a${i}: number = ${i};`)}\n}
class B extends A {\n${many(n - (n >> 1), i => `b${i}: number = ${i};`)}\nsum(): number { return this.a0 + this.a${(n >> 1) - 1} + this.b0 + this.b${n - (n >> 1) - 1}; } }
function first(a: A): number { return a.a0 + a.a${(n >> 1) - 1}; }
const c = new B; c.b0 = 7; c.a0 = 9; console.log(c.sum(), first(c), first(new A), Object.keys(c).length, Object.keys(c)[${n - 1}], JSON.stringify(c).length);`,
  },
  "public fields of five classes in a row": {
    file: "main.js",
    text: n => `${many(5, k => `class C${k} ${k ? `extends C${k - 1} ` : ""}{\n${many(Math.ceil(n / 5), i => `f${k}_${i} = ${i + k};`)}\n}`)}
const c = new C4; c.f4_0 = 5; c.f0_0 = 6; console.log(c.f0_0 + c.f4_0 + c.f3_7 + c.f4_${Math.ceil(n / 5) - 1}, Object.keys(c).length, Object.keys(c)[${n - 1}], Object.keys(new C3).length);`,
  },
  "stores of a constructor function and public fields of its heir": {
    file: "main.js",
    text: n => `function A() {\n${many(n >> 1, i => `this.a${i} = ${i};`)}\n}
class B extends A {\n${many(n - (n >> 1), i => `b${i} = ${i};`)}\n}
const c = new B; c.b0 = 7; console.log(c.a0 + c.b0 + c.a${(n >> 1) - 1} + c.b${n - (n >> 1) - 1}, Object.keys(c).length, Object.keys(c)[${n - 1}]);`,
  },
  "a large class with a large heir and a small one": {
    file: "main.js",
    text: n => `class A {\n${many(n - 200, i => `a${i} = ${i};`)}\n}
class B extends A {\n${many(200, i => `b${i} = ${i};`)}\n}
class C extends A {\n${many(9, i => `c${i} = ${i};`)}\n}
function read(o) { return o.a${n - 201} + (o.b199 ?? 0) + (o.c8 ?? 0) + (o.b0 ?? 0); }
console.log(read(new A), read(new B), read(new C), Object.keys(new B).length, Object.keys(new C).length);`,
  },
  "stores in a constructor": {
    file: "main.js",
    text: n => `class C { constructor() {\n${many(n, i => `this.p${i} = ${i};`)}\n} }
const c = new C; c.p${n - 1} = 7; console.log(c.p0 + c.p${n - 1}, Object.keys(c).length);`,
  },
  "an interface and a literal": {
    file: "main.ts",
    text: n => `interface T {\n${many(n, i => `p${i}: number;`)}\n}
const t: T = {\n${many(n, i => `p${i}: ${i},`)}\n};
function read(t: T): number { return t.p0 + t.p${n - 1} + t.p${n >> 1}; }
t.p${n - 1} = 7; console.log(read(t), Object.keys(t).length, JSON.stringify(t).length);`,
  },
  "static fields": {
    file: "main.js",
    text: n => `class C {\n${many(n, i => `static p${i} = ${i};`)}\n${many(8, i => `static #q${i} = ${i};`)}\nstatic sum() { return C.p0 + C.p${n - 1} + C.#q7; } }
console.log(C.sum(), Object.keys(C).length);`,
  },
  "methods": {
    file: "main.js",
    text: n => `class C {\n${many(n, i => `m${i}() { return ${i}; }`)}\n${many(n, i => `#n${i}() { return ${i}; }`)}\nsum() { return this.#n0() + this.#n${n - 1}(); } }
const c = new C; console.log(c.m0() + c.m${n - 1}() + c.sum(), Object.getOwnPropertyNames(C.prototype).length);`,
  },
  "an enum": {
    file: "main.ts",
    text: n =>
      `enum E {\n${many(n, i => `M${i},`)}\n}\nconsole.log(E.M0 + E.M${n - 1}, E[${n - 1}], Object.keys(E).length);`,
  },
};

generated(
  "a class with very many members",
  Object.entries(forms).flatMap(([form, { file, refusedFrom, text }]) =>
    [4094, 4095, 4096, 5000].map(count => ({
      name: `${count}: ${form}.`,
      isAlwaysRun: count === 4096,
      isOnlyCompiled: true as const,
      failsToday:
        refusedFrom !== undefined && count >= refusedFrom
          ? "the build is refused: properties per object type"
          : undefined,
      make: () => ({ file, text: text(count), files: { "tsconfig.json": tsconfig } }),
    })),
  ),
);
