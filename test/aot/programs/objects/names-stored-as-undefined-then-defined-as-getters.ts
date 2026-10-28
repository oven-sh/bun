// What TypeScript emits for `export { a } from "./b"` in CommonJS: every name is first stored as undefined, then defined as a getter.
const source: Record<string, number> = {};
for (let i = 0; i < 24; i++) source["name" + i] = i * 3;
function make(): any {
  const made: any = {};
  made.name0 = made.name1 = made.name2 = made.name3 = made.name4 = made.name5 = made.name6 = made.name7 = made.name8 = made.name9 = made.name10 = made.name11 = made.name12 = made.name13 = made.name14 = made.name15 = made.name16 = made.name17 = made.name18 = made.name19 = made.name20 = made.name21 = made.name22 = made.name23 = void 0;
  const before = Object.keys(made).length + ":" + String(made.name3) + ":" + JSON.stringify(Object.getOwnPropertyDescriptor(made, "name5"));
  Object.defineProperty(made, "name0", { enumerable: true, get: function () { return source.name0; } });
  Object.defineProperty(made, "name1", { enumerable: true, get: function () { return source.name1; } });
  Object.defineProperty(made, "name2", { enumerable: true, get: function () { return source.name2; } });
  Object.defineProperty(made, "name3", { enumerable: true, get: function () { return source.name3; } });
  Object.defineProperty(made, "name4", { enumerable: true, get: function () { return source.name4; } });
  Object.defineProperty(made, "name5", { enumerable: true, get: function () { return source.name5; } });
  Object.defineProperty(made, "name6", { enumerable: true, get: function () { return source.name6; } });
  Object.defineProperty(made, "name7", { enumerable: true, get: function () { return source.name7; } });
  Object.defineProperty(made, "name8", { enumerable: true, get: function () { return source.name8; } });
  Object.defineProperty(made, "name9", { enumerable: true, get: function () { return source.name9; } });
  Object.defineProperty(made, "name10", { enumerable: true, get: function () { return source.name10; } });
  Object.defineProperty(made, "name11", { enumerable: true, get: function () { return source.name11; } });
  Object.defineProperty(made, "name12", { enumerable: true, get: function () { return source.name12; } });
  Object.defineProperty(made, "name13", { enumerable: true, get: function () { return source.name13; } });
  Object.defineProperty(made, "name14", { enumerable: true, get: function () { return source.name14; } });
  Object.defineProperty(made, "name15", { enumerable: true, get: function () { return source.name15; } });
  Object.defineProperty(made, "name16", { enumerable: true, get: function () { return source.name16; } });
  Object.defineProperty(made, "name17", { enumerable: true, get: function () { return source.name17; } });
  Object.defineProperty(made, "name18", { enumerable: true, get: function () { return source.name18; } });
  Object.defineProperty(made, "name19", { enumerable: true, get: function () { return source.name19; } });
  Object.defineProperty(made, "name20", { enumerable: true, get: function () { return source.name20; } });
  Object.defineProperty(made, "name21", { enumerable: true, get: function () { return source.name21; } });
  Object.defineProperty(made, "name22", { enumerable: true, get: function () { return source.name22; } });
  Object.defineProperty(made, "name23", { enumerable: true, get: function () { return source.name23; } });
  made.before = before;
  return made;
}
const first = make(), second = make();
let sum = 0;
for (let round = 0; round < 3; round++) sum += first.name0 + first.name1 + first.name2 + first.name3 + first.name4 + first.name5 + first.name6 + first.name7 + first.name8 + first.name9 + first.name10 + first.name11 + first.name12 + first.name13 + first.name14 + first.name15 + first.name16 + first.name17 + first.name18 + first.name19 + first.name20 + first.name21 + first.name22 + first.name23;
console.log(sum, first.before, Object.keys(second).join(), typeof Object.getOwnPropertyDescriptor(second, "name7")!.get, Object.getOwnPropertyDescriptor(second, "name7")!.configurable);
try { "use strict"; second.name2 = 5; console.log("stored", second.name2); } catch (error) { console.log((error as Error).name); }
