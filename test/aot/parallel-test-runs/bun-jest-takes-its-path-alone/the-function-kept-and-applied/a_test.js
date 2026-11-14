import { test } from "bun:test";
const kept = Bun.jest;
test("called through a variable, apply() and bind()", () => {
  const path = import.meta.path;
  const all = [
    kept(path, true, true),
    kept.apply(Bun, [path, true, true]),
    Reflect.apply(kept, undefined, [path, 1, 1]),
    kept.bind(null, path, true)(true),
  ];
  console.log("SAID", all.map(one => typeof one).join(), kept.length, kept.name);
});
