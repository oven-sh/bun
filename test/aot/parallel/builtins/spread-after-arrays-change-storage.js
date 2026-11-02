// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=3
// Env of the executable: BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
const show = value =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label, probe) => {
  let text;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + error.constructor.name;
  }
  console.log(label + ": " + text);
};
const holder = {};
Object.create(holder);
let calls = 0;
const source = [1, 2, 3, 4];
const mapped = source.map(x => {
  if (++calls === 2)
    Object.defineProperty(holder, 0, {
      get() {
        return "inherited";
      },
      configurable: true,
    });
  return x * 2;
});
function createArrays(a, b) {
  return [
    [...a],
    [...a, 9],
    [0, ...a, ...b],
    [...b.filter(x => x > 1)],
    Array.from(a, x => x + 1),
    Array.from({ length: 3 }, (_, i) => i),
    a.concat(b),
    a.slice(1),
    b.map(x => x + 0.5),
    b.flatMap(x => [x, x]),
  ];
}
function extend(list) {
  list.push(7);
  list[list.length + 1] = 8;
  return [list, list.length, Object.keys(list).join()];
}
report("mapped", () => [mapped, mapped.length, Object.keys(mapped).join()]);
report("first", () => createArrays(mapped, source).map(extend));
Bun.gc(true);
report("after a collection", () => createArrays(mapped, source).map(extend));
let total = 0;
for (let round = 0; round < 200; round++) for (const list of createArrays(mapped, source)) total += extend(list)[1];
report("200 rounds", () => total);
