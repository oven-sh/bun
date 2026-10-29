// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
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
function concat(a: unknown[], b: unknown): unknown[] {
  return a.concat(b);
}
function concatOnto(receiver: unknown, b: unknown): unknown[] {
  return Array.prototype.concat.call(receiver, b);
}
function createUnspreadable(): unknown[] {
  const list: unknown[] = [1, 2];
  (list as any)[Symbol.isConcatSpreadable] = false;
  return list;
}
function createSpreadable(): object {
  return { length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: true };
}
report("ordinary arrays", () => concat([0], [1, 2]));
report("unspreadable argument", () => concat([0], createUnspreadable()));
report("unspreadable receiver", () => concat(createUnspreadable(), [3]));
report("unspreadable receiver and argument", () => concat(createUnspreadable(), createUnspreadable()));
report("spreadable argument", () => concat([0], createSpreadable()));
report("spreadable receiver", () => concatOnto(createSpreadable(), [3]));
report("array-like argument without the symbol", () => concat([0], { length: 1, 0: "a" }));
report("array-like receiver without the symbol", () => concatOnto({ length: 1, 0: "a" }, [3]));
