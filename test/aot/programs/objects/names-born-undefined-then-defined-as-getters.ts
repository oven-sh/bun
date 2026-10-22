// Every name is born undefined in the literal, then defined as a getter: more names than fit in the cell.
const source: Record<string, number> = {};
for (let i = 0; i < 24; i++) source["name" + i] = i * 3;
function make(): any {
  const made: any = { name0: void 0, name1: void 0, name2: void 0, name3: void 0, name4: void 0, name5: void 0, name6: void 0, name7: void 0, name8: void 0, name9: void 0, name10: void 0, name11: void 0, name12: void 0, name13: void 0, name14: void 0, name15: void 0, name16: void 0, name17: void 0, name18: void 0, name19: void 0, name20: void 0, name21: void 0, name22: void 0, name23: void 0 };
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
  return [made, before];
}
const [first, before] = make(), [second] = make();
let sum = 0;
for (let round = 0; round < 3; round++) sum += first.name0 + first.name1 + first.name2 + first.name3 + first.name4 + first.name5 + first.name6 + first.name7 + first.name8 + first.name9 + first.name10 + first.name11 + first.name12 + first.name13 + first.name14 + first.name15 + first.name16 + first.name17 + first.name18 + first.name19 + first.name20 + first.name21 + first.name22 + first.name23;
console.log(sum, before, Object.keys(second).join(), typeof Object.getOwnPropertyDescriptor(second, "name7")!.get, Object.getOwnPropertyDescriptor(second, "name7")!.configurable);
