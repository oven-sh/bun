// An object is handed to a function that the compiler knows nothing about, and then a function that loads a module by name is stored on it.
// The variable that holds the object may also hold what such a function answers. The call through the variable loads the module.
import { isIP } from "node:net";
console.log("the name that is imported:", String(isIP("1.1.1.1")));
const key = ["Soc", "ket"].join("");
const name = ["node:", "net"].join("");
const anything = globalThis[["Str", "ing"].join("")];
const holder = {};
console.log(anything(holder));
holder.load = process.getBuiltinModule;
let either = holder;
const swap = {
  next: () => {
    if (name.length > 100) either = anything(name);
  },
};
swap.next();
const step0 = { next: () => either.load(name) };
const step1 = { next: () => step0.next() };
const step2 = { next: () => step1.next() };
const step3 = { next: () => step2.next() };
const whole = step3.next();
console.log("the other member:", String(new whole[key]().destroyed));
