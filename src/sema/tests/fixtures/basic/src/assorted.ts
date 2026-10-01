// Casts of parenthesised operands, functions called where they are written, dead branches, arrays by extension,
// a class that is also a function, names that do not exist.
declare class Pt {
  x: number;
  y: number;
  add(dx: number, dy: number): Pt;
  constructor(x: number, y: number);
}
const c1 = <Pt>{
  x: 0,
  y: 0,
  add: function (dx, dy) {
    return new Pt(dx, dy);
  },
};
const c2 = {
  x: 0,
  y: 0,
  add: function (dx, dy) {
    return new Pt(dx, dy);
  },
} as Pt;
const c3 = <Pt>{
  x: 0,
  y: 0,
  add(dx, dy) {
    return new Pt(dx, dy);
  },
};
declare const itNum: Iterable<number>;
(function (a, ...rest) {
  return [a, rest] as const;
})("", true, ...itNum);
((a, b) => [a, b] as const)(1, "x");
(function (a, b?) {
  return [a, b] as const;
})(1);
class A1 {
  foo!: number;
}
class B1 extends A1 {
  bar!: number;
}
const x2: (a: A1) => void = true ? a => a.foo : b => b.foo;
function f1() {
  let x = "".match(/ /);
  let y = x || [];
  let z = y.map(s => s.toLowerCase());
  return z;
}
interface IOpt {
  name?: string;
  flag?: boolean;
}
class Parser1 {
  public options!: IOpt[];
  public m() {
    this.options = this.options.sort(function (a, b) {
      var aName = a.name!.toLowerCase();
      var bName = b.name!.toLowerCase();
      return aName > bName ? 1 : -1;
    });
  }
}
declare function D1(): string;
declare class D1 {
  constructor(value: number);
}
var s1 = D1();
var s2 = new D1(1);
let missing1: NotThere[] = [];
let missing2 = notThere2.foo;
function usesMissing(p: NotThere, q: Array<NotThere>) {
  return [p, q] as const;
}

// More of functions called on the spot; what can and cannot be added.
((j?) => j + 1)(12);
((k?) => k + 1)();
((l, o?) => l + o)(12);
let twelve = (f => f(12))(i => i);
let eleven = (o => o.a(11))({
  a: function (n) {
    return n;
  },
});
((m = 10) => m + 1)(12);
((n = 10) => n + 1)();
(({ p = 14 }) => p)({ p: 15 });
(({ u = 22 } = { u: 23 }) => u)();
declare const maybe: number | undefined, str: string, unk: unknown, sym: symbol, obj: {};
const p1 = maybe + 1;
const p2 = maybe + str;
const p3 = unk + 1;
const p4 = obj + obj;
const p5 = null + 1;
const p6 = undefined + undefined;
const p7 = obj + str;
const p8 = 1n + 1;
function opt(a?, b = 1, ...c) {
  return [a, b, c] as const;
}
const optArrow = (a?, b?: number) => [a, b] as const;

// An object that fits no member of a union on its own, but every way it can be is some member's.
type DiscU = { kind: "a"; n: number } | { kind: "b"; n: number } | { kind: "c"; s: string };
declare const discFlag: boolean, discAB: "a" | "b", discSrc: { kind: "a" | "b"; n: number };
export function disc1(): DiscU {
  return { kind: discFlag ? "a" : "b", n: 1 };
}
export function disc2(kind: "a" | "b"): DiscU {
  return { kind, n: 1 };
}
export const disc3: DiscU[] = [discSrc, { kind: discAB, n: 2 }, { kind: "c", s: "" }];
// Templates that fit templates.
declare const tplS: string, tplN: number, tplTwo: `a-${string}-${number}`;
export const tpl1: `a-${string}` = tplTwo;
export const tpl2: `${string}-${number}` = tplTwo;
export const tpl3: `a-${string}` = `a-${tplS}-${tplN}`;
export const tpl4: `${number}px` = `${tplN}px`;
type TplTail<T> = T extends `a-${infer R}` ? R : never;
export declare const tplTails: { a: TplTail<typeof tplTwo>; b: TplTail<"a-x">; c: TplTail<`a-${number}`> };
// Awaited.
export async function aw1<T>(x: T): Promise<T> {
  const y = await x;
  return y;
}
export async function aw2<T>(g: () => Promise<T>): Promise<T> {
  return await g();
}
export async function aw3<T>(x: Promise<T>): Promise<T> {
  const y = await x;
  const z = await y;
  return z;
}
export async function aw4<T>(xs: Promise<T>[]): Promise<T[]> {
  return await Promise.all(xs);
}
// A primitive is narrowed to the literals it is compared with.
export function lit1(x: string, o: { k: string }) {
  if (x === "a" || x === "b") return { x };
  if (o.k === "c") return { k: o.k };
  return null;
}
export function lit2(x: number) {
  switch (x) {
    case 1:
      return { x };
    case 2:
      return { x };
  }
  return { x };
}
let voidDone: () => void = () => {};
export const voidPromise = new Promise<void>(resolve => {
  voidDone = resolve;
});
export {};
