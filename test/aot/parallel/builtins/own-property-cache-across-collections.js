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
function has(o, k) {
  return Object.hasOwn(o, k);
}
function buildKey(head, tail) {
  return head + tail.slice(0);
}
function hasEach(o, parts) {
  return parts.map(([head, tail]) => has(o, buildKey(head, tail)));
}
function checkNames(o) {
  return [
    hasEach(o, [
      ["na", "me"],
      ["no", "ne"],
    ]),
    has(o, { toString: () => buildKey("na", "me") }),
  ];
}
function checkAroundStore(o) {
  const parts = [
      ["k", "1"],
      ["k", "2"],
      ["ne", "w"],
    ],
    before = hasEach(o, parts);
  o[buildKey("ne", "w")] = 1;
  const stored = hasEach(o, parts);
  delete o[buildKey("ne", "w")];
  return [before, stored, hasEach(o, parts)];
}
function createDictionary() {
  const o = {};
  for (let i = 0; i < 200; i++) o["k" + i] = i;
  for (let i = 0; i < 200; i += 2) delete o["k" + i];
  return o;
}
const subject = { name: 1, other: 2 };
report("before a collection", () => checkNames(subject));
Bun.gc(true);
report("after a collection", () => checkNames(subject));
report("ordinary object", () => checkAroundStore({ k1: 1 }));
report("dictionary", () => checkAroundStore(createDictionary()));
report("proxy", () => checkAroundStore(new Proxy({ k1: 1 }, {})));
let found = 0;
for (let round = 0; round < 500; round++) {
  const o = { name: round, ["k" + (round % 7)]: 1 };
  for (const answer of hasEach(o, [
    ["na", "me"],
    ["k", String(round % 5)],
    ["oth", "er"],
  ]))
    if (answer) found++;
}
report("500 rounds", () => found);
