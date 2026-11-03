// One name of node:net is imported and used; another, Socket, is found through process.getBuiltinModule, read on a spread of process by a function far down a chain of calls, after the spread was handed to a function found under a computed key.
// So are a spread of that spread, and an object that inherits from it.
import { isIP } from "node:net";
console.log("the name that is imported:", String(isIP("1.1.1.1")));
const key = ["Soc", "ket"].join("");
const name = ["node:", "net"].join("");
const anything = globalThis[["Str", "ing"].join("")];
for (const copy of [{ ...process }, { ...{ ...process } }, Object.create({ ...process })]) {
  console.log(anything(copy));
  const step0 = { next: () => copy.getBuiltinModule(name) };
  const step1 = { next: () => step0.next() };
  const step2 = { next: () => step1.next() };
  const step3 = { next: () => step2.next() };
  const step4 = { next: () => step3.next() };
  const step5 = { next: () => step4.next() };
  const step6 = { next: () => step5.next() };
  const step7 = { next: () => step6.next() };
  const F = step7.next()[key];
  console.log("the other member:", String(new F().destroyed));
}
