import { test } from "bun:test";
import { asks } from "./product.mjs";
// Each function of a built-in object that has a door for boxed values is called at one site of the product, replaced by a test, called, put back and called again.
test("each is heard", () => {
  const define = Reflect.defineProperty, fake = () => "laid", said = [];
  const ask = name => { try { return String(asks[name]()); } catch (e) { return e.constructor.name; } };
  {
    const real = JSON.stringify;
    { const row = ["stringify", "store", ask("stringify"), ask("stringify")]; JSON.stringify = fake; const between = ask("stringify"); define(JSON, "stringify", { value: real, configurable: true, writable: true }); row.push(between, ask("stringify")); said.push(row.join(" ")); }
    { const row = ["stringify", "define", ask("stringify"), ask("stringify")]; define(JSON, "stringify", { value: fake, configurable: true, writable: true }); const between = ask("stringify"); define(JSON, "stringify", { value: real, configurable: true, writable: true }); row.push(between, ask("stringify")); said.push(row.join(" ")); }
    { const row = ["stringify", "reflect", ask("stringify"), ask("stringify")]; Reflect.set(JSON, "stringify", fake); const between = ask("stringify"); define(JSON, "stringify", { value: real, configurable: true, writable: true }); row.push(between, ask("stringify")); said.push(row.join(" ")); }
    { const row = ["stringify", "getter", ask("stringify"), ask("stringify")]; define(JSON, "stringify", { get: () => fake, configurable: true }); const between = ask("stringify"); define(JSON, "stringify", { value: real, configurable: true, writable: true }); row.push(between, ask("stringify")); said.push(row.join(" ")); }
    { const row = ["stringify", "delete", ask("stringify"), ask("stringify")]; delete JSON.stringify; const between = ask("stringify"); define(JSON, "stringify", { value: real, configurable: true, writable: true }); row.push(between, ask("stringify")); said.push(row.join(" ")); }
  }
  {
    const real = Array.isArray;
    { const row = ["isArray", "store", ask("isArray"), ask("isArray")]; Array.isArray = fake; const between = ask("isArray"); define(Array, "isArray", { value: real, configurable: true, writable: true }); row.push(between, ask("isArray")); said.push(row.join(" ")); }
    { const row = ["isArray", "define", ask("isArray"), ask("isArray")]; define(Array, "isArray", { value: fake, configurable: true, writable: true }); const between = ask("isArray"); define(Array, "isArray", { value: real, configurable: true, writable: true }); row.push(between, ask("isArray")); said.push(row.join(" ")); }
    { const row = ["isArray", "reflect", ask("isArray"), ask("isArray")]; Reflect.set(Array, "isArray", fake); const between = ask("isArray"); define(Array, "isArray", { value: real, configurable: true, writable: true }); row.push(between, ask("isArray")); said.push(row.join(" ")); }
    { const row = ["isArray", "getter", ask("isArray"), ask("isArray")]; define(Array, "isArray", { get: () => fake, configurable: true }); const between = ask("isArray"); define(Array, "isArray", { value: real, configurable: true, writable: true }); row.push(between, ask("isArray")); said.push(row.join(" ")); }
    { const row = ["isArray", "delete", ask("isArray"), ask("isArray")]; delete Array.isArray; const between = ask("isArray"); define(Array, "isArray", { value: real, configurable: true, writable: true }); row.push(between, ask("isArray")); said.push(row.join(" ")); }
  }
  {
    const real = Math.max;
    { const row = ["max", "store", ask("max"), ask("max")]; Math.max = fake; const between = ask("max"); define(Math, "max", { value: real, configurable: true, writable: true }); row.push(between, ask("max")); said.push(row.join(" ")); }
    { const row = ["max", "define", ask("max"), ask("max")]; define(Math, "max", { value: fake, configurable: true, writable: true }); const between = ask("max"); define(Math, "max", { value: real, configurable: true, writable: true }); row.push(between, ask("max")); said.push(row.join(" ")); }
    { const row = ["max", "reflect", ask("max"), ask("max")]; Reflect.set(Math, "max", fake); const between = ask("max"); define(Math, "max", { value: real, configurable: true, writable: true }); row.push(between, ask("max")); said.push(row.join(" ")); }
    { const row = ["max", "getter", ask("max"), ask("max")]; define(Math, "max", { get: () => fake, configurable: true }); const between = ask("max"); define(Math, "max", { value: real, configurable: true, writable: true }); row.push(between, ask("max")); said.push(row.join(" ")); }
    { const row = ["max", "delete", ask("max"), ask("max")]; delete Math.max; const between = ask("max"); define(Math, "max", { value: real, configurable: true, writable: true }); row.push(between, ask("max")); said.push(row.join(" ")); }
  }
  {
    const real = Math.min;
    { const row = ["min", "store", ask("min"), ask("min")]; Math.min = fake; const between = ask("min"); define(Math, "min", { value: real, configurable: true, writable: true }); row.push(between, ask("min")); said.push(row.join(" ")); }
    { const row = ["min", "define", ask("min"), ask("min")]; define(Math, "min", { value: fake, configurable: true, writable: true }); const between = ask("min"); define(Math, "min", { value: real, configurable: true, writable: true }); row.push(between, ask("min")); said.push(row.join(" ")); }
    { const row = ["min", "reflect", ask("min"), ask("min")]; Reflect.set(Math, "min", fake); const between = ask("min"); define(Math, "min", { value: real, configurable: true, writable: true }); row.push(between, ask("min")); said.push(row.join(" ")); }
    { const row = ["min", "getter", ask("min"), ask("min")]; define(Math, "min", { get: () => fake, configurable: true }); const between = ask("min"); define(Math, "min", { value: real, configurable: true, writable: true }); row.push(between, ask("min")); said.push(row.join(" ")); }
    { const row = ["min", "delete", ask("min"), ask("min")]; delete Math.min; const between = ask("min"); define(Math, "min", { value: real, configurable: true, writable: true }); row.push(between, ask("min")); said.push(row.join(" ")); }
  }
  {
    const real = Object.is;
    { const row = ["is", "store", ask("is"), ask("is")]; Object.is = fake; const between = ask("is"); define(Object, "is", { value: real, configurable: true, writable: true }); row.push(between, ask("is")); said.push(row.join(" ")); }
    { const row = ["is", "define", ask("is"), ask("is")]; define(Object, "is", { value: fake, configurable: true, writable: true }); const between = ask("is"); define(Object, "is", { value: real, configurable: true, writable: true }); row.push(between, ask("is")); said.push(row.join(" ")); }
    { const row = ["is", "reflect", ask("is"), ask("is")]; Reflect.set(Object, "is", fake); const between = ask("is"); define(Object, "is", { value: real, configurable: true, writable: true }); row.push(between, ask("is")); said.push(row.join(" ")); }
    { const row = ["is", "getter", ask("is"), ask("is")]; define(Object, "is", { get: () => fake, configurable: true }); const between = ask("is"); define(Object, "is", { value: real, configurable: true, writable: true }); row.push(between, ask("is")); said.push(row.join(" ")); }
    { const row = ["is", "delete", ask("is"), ask("is")]; delete Object.is; const between = ask("is"); define(Object, "is", { value: real, configurable: true, writable: true }); row.push(between, ask("is")); said.push(row.join(" ")); }
  }
  {
    const real = Object.getPrototypeOf;
    { const row = ["getPrototypeOf", "store", ask("getPrototypeOf"), ask("getPrototypeOf")]; Object.getPrototypeOf = fake; const between = ask("getPrototypeOf"); define(Object, "getPrototypeOf", { value: real, configurable: true, writable: true }); row.push(between, ask("getPrototypeOf")); said.push(row.join(" ")); }
    { const row = ["getPrototypeOf", "define", ask("getPrototypeOf"), ask("getPrototypeOf")]; define(Object, "getPrototypeOf", { value: fake, configurable: true, writable: true }); const between = ask("getPrototypeOf"); define(Object, "getPrototypeOf", { value: real, configurable: true, writable: true }); row.push(between, ask("getPrototypeOf")); said.push(row.join(" ")); }
    { const row = ["getPrototypeOf", "reflect", ask("getPrototypeOf"), ask("getPrototypeOf")]; Reflect.set(Object, "getPrototypeOf", fake); const between = ask("getPrototypeOf"); define(Object, "getPrototypeOf", { value: real, configurable: true, writable: true }); row.push(between, ask("getPrototypeOf")); said.push(row.join(" ")); }
    { const row = ["getPrototypeOf", "getter", ask("getPrototypeOf"), ask("getPrototypeOf")]; define(Object, "getPrototypeOf", { get: () => fake, configurable: true }); const between = ask("getPrototypeOf"); define(Object, "getPrototypeOf", { value: real, configurable: true, writable: true }); row.push(between, ask("getPrototypeOf")); said.push(row.join(" ")); }
    { const row = ["getPrototypeOf", "delete", ask("getPrototypeOf"), ask("getPrototypeOf")]; delete Object.getPrototypeOf; const between = ask("getPrototypeOf"); define(Object, "getPrototypeOf", { value: real, configurable: true, writable: true }); row.push(between, ask("getPrototypeOf")); said.push(row.join(" ")); }
  }
  {
    const real = Object.setPrototypeOf;
    { const row = ["setPrototypeOf", "store", ask("setPrototypeOf"), ask("setPrototypeOf")]; Object.setPrototypeOf = fake; const between = ask("setPrototypeOf"); define(Object, "setPrototypeOf", { value: real, configurable: true, writable: true }); row.push(between, ask("setPrototypeOf")); said.push(row.join(" ")); }
    { const row = ["setPrototypeOf", "define", ask("setPrototypeOf"), ask("setPrototypeOf")]; define(Object, "setPrototypeOf", { value: fake, configurable: true, writable: true }); const between = ask("setPrototypeOf"); define(Object, "setPrototypeOf", { value: real, configurable: true, writable: true }); row.push(between, ask("setPrototypeOf")); said.push(row.join(" ")); }
    { const row = ["setPrototypeOf", "reflect", ask("setPrototypeOf"), ask("setPrototypeOf")]; Reflect.set(Object, "setPrototypeOf", fake); const between = ask("setPrototypeOf"); define(Object, "setPrototypeOf", { value: real, configurable: true, writable: true }); row.push(between, ask("setPrototypeOf")); said.push(row.join(" ")); }
    { const row = ["setPrototypeOf", "getter", ask("setPrototypeOf"), ask("setPrototypeOf")]; define(Object, "setPrototypeOf", { get: () => fake, configurable: true }); const between = ask("setPrototypeOf"); define(Object, "setPrototypeOf", { value: real, configurable: true, writable: true }); row.push(between, ask("setPrototypeOf")); said.push(row.join(" ")); }
    { const row = ["setPrototypeOf", "delete", ask("setPrototypeOf"), ask("setPrototypeOf")]; delete Object.setPrototypeOf; const between = ask("setPrototypeOf"); define(Object, "setPrototypeOf", { value: real, configurable: true, writable: true }); row.push(between, ask("setPrototypeOf")); said.push(row.join(" ")); }
  }
  {
    const real = globalThis.isNaN;
    { const row = ["isNaN", "store", ask("isNaN"), ask("isNaN")]; globalThis.isNaN = fake; const between = ask("isNaN"); define(globalThis, "isNaN", { value: real, configurable: true, writable: true }); row.push(between, ask("isNaN")); said.push(row.join(" ")); }
    { const row = ["isNaN", "define", ask("isNaN"), ask("isNaN")]; define(globalThis, "isNaN", { value: fake, configurable: true, writable: true }); const between = ask("isNaN"); define(globalThis, "isNaN", { value: real, configurable: true, writable: true }); row.push(between, ask("isNaN")); said.push(row.join(" ")); }
    { const row = ["isNaN", "reflect", ask("isNaN"), ask("isNaN")]; Reflect.set(globalThis, "isNaN", fake); const between = ask("isNaN"); define(globalThis, "isNaN", { value: real, configurable: true, writable: true }); row.push(between, ask("isNaN")); said.push(row.join(" ")); }
    { const row = ["isNaN", "getter", ask("isNaN"), ask("isNaN")]; define(globalThis, "isNaN", { get: () => fake, configurable: true }); const between = ask("isNaN"); define(globalThis, "isNaN", { value: real, configurable: true, writable: true }); row.push(between, ask("isNaN")); said.push(row.join(" ")); }
    { const row = ["isNaN", "delete", ask("isNaN"), ask("isNaN")]; delete globalThis.isNaN; const between = ask("isNaN"); define(globalThis, "isNaN", { value: real, configurable: true, writable: true }); row.push(between, ask("isNaN")); said.push(row.join(" ")); }
  }
  console.log("SAID " + said.join(" | "));
});
