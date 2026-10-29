// One name of node:net is imported and used; another, Socket, is found through process.getBuiltinModule, held under another name: it is stored on an object that was handed to a function found under a computed key before, and called there by a function far down a chain of calls.
import { isIP } from "node:net";
console.log("the name that is imported:", String(isIP("1.1.1.1")));
const key = ["Soc", "ket"].join("");
const name = ["node:", "net"].join("");
const anything = globalThis[["Str", "ing"].join("")];
const holder = {};
console.log(anything(holder));
holder.load = process.getBuiltinModule;
const step0 = { next: () => holder.load(name) };
const step1 = { next: () => step0.next() };
const step2 = { next: () => step1.next() };
const step3 = { next: () => step2.next() };
const step4 = { next: () => step3.next() };
const step5 = { next: () => step4.next() };
const step6 = { next: () => step5.next() };
const step7 = { next: () => step6.next() };
const whole = step7.next();
console.log("the other member:", String(new whole[key]().destroyed));
