// A typed higher-order call enters the callee directly when its signature matches, and every other kind of callee answers as it does under `bun run`.
type Binary = (a: number, b: number) => number;
type BinaryText = (a: number, b: number) => string;

function apply(f: Binary, a: number, b: number): number {
  return f(a, b);
}
function applyText(f: BinaryText, a: number, b: number): string {
  return f(a, b);
}
function sum(f: Binary, rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i++) total = (total + apply(f, i, 3)) | 0;
  return total;
}
function joined(f: BinaryText, rounds: number): number {
  let length = 0;
  for (let i = 0; i < rounds; i++) length += applyText(f, i, 3).length;
  return length;
}
function report(name: string, run: () => unknown): void {
  try {
    console.log(name + ": " + String(run()));
  } catch (error) {
    console.log(name + ": throws " + (error as Error).name);
  }
}

const rounds = 20_000;
const add: Binary = (a, b) => a + b;
const first: Binary = a => a * 2;
const constant: Binary = () => 7;
const counted: Binary = (...values: number[]) => values.length + values[1];
const defaulted: Binary = (a, b = 100) => a - b;
report("exact signature", () => sum(add, rounds));
report("fewer parameters", () => sum(first, rounds));
report("no parameters", () => sum(constant, rounds));
report("rest parameter", () => sum(counted, rounds));
report("default parameter", () => sum(defaulted, rounds));

const text: BinaryText = (a, b) => a + ":" + b;
const textOfFirst: BinaryText = a => "value " + a;
const textOfRest: BinaryText = (...values: number[]) => values.join("-");
report("text, exact signature", () => joined(text, rounds));
report("text, fewer parameters", () => joined(textOfFirst, rounds));
report("text, rest parameter", () => joined(textOfRest, rounds));

const holder = {
  scale: 5,
  f(this: { scale: number }, a: number, b: number): number {
    return this.scale * a + b;
  },
};
function applyMethod(target: { scale: number; f: Binary }, a: number): number {
  return target.f(a, 1);
}
report("method receives this", () => {
  let total = 0;
  for (let i = 0; i < rounds; i++) total = (total + applyMethod(holder, i)) | 0;
  return total;
});
function strictThis(this: unknown, a: number, b: number): number {
  "use strict";
  return this === undefined ? a + b : -1;
}
report("plain call passes undefined", () => sum(strictThis, rounds));

const withProperty = Object.assign((a: number, b: number): number => a - b, { label: "subtract" });
report("added property", () => sum(withProperty, rounds) + withProperty.label);

const receiver = { base: 11 };
function addBase(this: { base: number }, a: number, b: number): number {
  return this.base + a + b;
}
report("bound function", () => sum(addBase.bind(receiver), rounds));
report("bound argument", () => sum(addBase.bind(receiver, 1) as unknown as Binary, rounds));
report("host function", () => sum(Math.max, rounds));

let proxyCalls = 0;
const proxied = new Proxy(add, {
  apply(target, thisValue, args) {
    proxyCalls++;
    return Reflect.apply(target, thisValue, args) + 1;
  },
});
report("proxy", () => sum(proxied, rounds) + " after " + proxyCalls + " calls");

const notFunction: any = 5;
report("not a function", () => apply(notFunction, 1, 2));

const wrongResult: any = (a: number, b: number) => "text " + (a + b);
function wrongResultOutcome(): string {
  try {
    const value: unknown = apply(wrongResult, 1, 2);
    return value === "text 3" ? "unchanged" : "converted";
  } catch (error) {
    return error instanceof TypeError ? "unchanged" : "converted";
  }
}
report("wrong result is never converted", wrongResultOutcome);

const deep: Binary = (a, b) => apply(deep, a + 1, b) + 1;
report("deep recursion", () => deep(0, 1));
report("call after deep recursion", () => sum(add, 10));

export {};
