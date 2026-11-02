// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// Env of the executable: BUN_JSC_slowPathAllocsBetweenGCs=3
// Env of the executable: BUN_JSC_useEdenCollectionsAtSlowPathAllocs=1
// Env of the executable: BUN_JSC_useZombieMode=1
// Env of the executable: BUN_JSC_scribbleFreeCells=1
const show = (value: unknown): string =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label: string, probe: () => unknown): void => {
  let text: string;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  console.log(label + ": " + text);
};
const make = () => ({
  a() {
    return 1;
  },
  b() {
    return 2;
  },
  c() {
    return 3;
  },
  d() {
    return 4;
  },
  e() {
    return 5;
  },
  f() {
    return 6;
  },
  g() {
    return 7;
  },
  h() {
    return 8;
  },
  i() {
    return 9;
  },
  j() {
    return 10;
  },
  k() {
    return 11;
  },
  l() {
    return 12;
  },
});
type Methods = ReturnType<typeof make>;
type Method = () => number;
function listValues(o: Methods): Method[] {
  return Object.values(o);
}
function listEntryValues(o: Methods): Method[] {
  return Object.entries(o).map(pair => pair[1]);
}
function collectEntryValues(o: Methods): Method[] {
  const methods: Method[] = [];
  for (const [key, value] of Object.entries(o)) if (key !== "") methods.push(value);
  return methods;
}
function listUntypedValues(o: any): Method[] {
  return Object.values(o);
}
function sumCalls(list: (o: Methods) => Method[], rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const methods = list(make()),
      garbage: { round: number }[] = [];
    for (let n = 0; n < 40; n++) garbage.push({ round });
    for (const method of methods) sum += method();
    sum += garbage[round % 40].round;
  }
  return sum;
}
function keepsIdentity(o: Methods): boolean {
  const before = Object.values(o);
  Bun.gc(true);
  return Object.values(o)[0] === o.a && before[0] === o.a && before[11]() === 12;
}
let runs = 0;
const tag = Symbol("tag");
function listOwn(o: any): unknown {
  return [Object.values(o), Object.entries(o)];
}
function reportOtherSubjects(when: string): void {
  report(when + ": getter", () => [
    listOwn({
      first: 1,
      get second() {
        return ++runs;
      },
      third: 3,
    }),
    runs,
  ]);
  report(when + ": index key", () => listOwn({ b: 2, 1: "a" }));
  report(when + ": hidden", () => listOwn(Object.defineProperty({ shown: 1, [tag]: 2 }, "hidden", { value: 3 })));
  report(when + ": own __proto__", () => listOwn(JSON.parse('{"__proto__": 1, "x": 2}')));
  report(when + ": proxy", () => listOwn(new Proxy({ a: 1, b: 2 }, { ownKeys: () => ["b", "a"] })));
  report(when + ": null", () => listOwn(null));
  report(when + ": string", () => listOwn("ab"));
}
for (const list of [listValues, listEntryValues, collectEntryValues, listUntypedValues])
  report(list.name, () => sumCalls(list, 750));
report("identity", () => [keepsIdentity(make()), keepsIdentity(make())]);
reportOtherSubjects("before");
const holder = {};
Object.create(holder);
Object.defineProperty(holder, 0, {
  get() {
    return "inherited";
  },
  configurable: true,
});
reportOtherSubjects("after a bad time");
report("methods after a bad time", () => sumCalls(listValues, 10) + sumCalls(listEntryValues, 10));
