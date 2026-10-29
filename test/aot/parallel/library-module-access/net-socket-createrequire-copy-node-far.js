// One name of node:net is imported and used; another, Socket, is found through the function that createRequire returns. createRequire is read on a spread of node:module by a function far down a chain of calls, after the spread was handed to a function found under a computed key.
// So are a spread of that spread, an object that inherits from it, and what Object.assign copies.
import Module from "node:module";
import { isIP } from "node:net";
console.log("the name that is imported:", String(isIP("1.1.1.1")));
const key = ["Soc", "ket"].join("");
const name = ["node:", "net"].join("");
const anything = globalThis[["Str", "ing"].join("")];
for (const copy of [{ ...Module }, { ...{ ...Module } }, Object.create({ ...Module }), Object.assign({}, Module)]) {
  console.log(anything(copy));
  const step0 = { next: () => copy.createRequire(import.meta.url) };
  const step1 = { next: () => step0.next() };
  const step2 = { next: () => step1.next() };
  const step3 = { next: () => step2.next() };
  const step4 = { next: () => step3.next() };
  const step5 = { next: () => step4.next() };
  const step6 = { next: () => step5.next() };
  const step7 = { next: () => step6.next() };
  const load = step7.next();
  console.log("what it resolves:", load.resolve(name));
  const F = load(name)[key];
  console.log("the other member:", String(new F().destroyed));
}
