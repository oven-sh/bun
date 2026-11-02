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
function createAndPush(extra: string): string[] {
  const list = [
    "s00",
    "s01",
    "s02",
    "s03",
    "s04",
    "s05",
    "s06",
    "s07",
    "s08",
    "s09",
    "s10",
    "s11",
    "s12",
    "s13",
    "s14",
    "s15",
    "s16",
    "s17",
    "s18",
    "s19",
    "s20",
    "s21",
    "s22",
    "s23",
    "s24",
    "s25",
    "s26",
    "s27",
    "s28",
    "s29",
    "s30",
    "s31",
    "s32",
    "s33",
    "s34",
    "s35",
    "s36",
    "s37",
    "s38",
    "s39",
  ];
  list.push(extra);
  return list;
}
function createOnly(): string[] {
  return [
    "s00",
    "s01",
    "s02",
    "s03",
    "s04",
    "s05",
    "s06",
    "s07",
    "s08",
    "s09",
    "s10",
    "s11",
    "s12",
    "s13",
    "s14",
    "s15",
    "s16",
    "s17",
    "s18",
    "s19",
    "s20",
    "s21",
    "s22",
    "s23",
    "s24",
    "s25",
    "s26",
    "s27",
    "s28",
    "s29",
    "s30",
    "s31",
    "s32",
    "s33",
    "s34",
    "s35",
    "s36",
    "s37",
    "s38",
    "s39",
  ];
}
function compare(a: string[], b: string[]): boolean[] {
  return [a === b, a.join() === b.join()];
}
function store(a: string[], b: string[]): string[] {
  a[0] = "changed";
  return [a[0], b[0], createOnly()[0]];
}
let total = 0;
for (let round = 0; round < 10000; round++) {
  const list = createAndPush("extra" + round);
  total += list.length + list[round % 41].length;
}
report("total", () => total);
report("two arrays", () => compare(createOnly(), createOnly()));
report("store to one", () => store(createOnly(), createOnly()));
report("two arrays after the store", () => compare(createOnly(), createOnly()));
