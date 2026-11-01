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
function floor(a: number, b: number): number {
  return Math.floor(a / b);
}
function ceil(a: number, b: number): number {
  return Math.ceil(a / b);
}
function trunc(a: number, b: number): number {
  return Math.trunc(a / b);
}
function round(a: number, b: number): number {
  return Math.round(a / b);
}
function orZero(a: number, b: number): number {
  return (a / b) | 0;
}
function notTwice(a: number, b: number): number {
  return ~~(a / b);
}
function shiftByZero(a: number, b: number): number {
  return (a / b) >>> 0;
}
function imul(a: number, b: number): number {
  return Math.imul(a / b, 3);
}
function roundEachWay(a: number, b: number): number[] {
  const rounded = [floor(a, b), ceil(a, b), trunc(a, b), round(a, b)];
  return [...rounded, orZero(a, b), notTwice(a, b), shiftByZero(a, b), imul(a, b)];
}
for (let a = -4; a <= 4; a++)
  for (let b = -3; b <= 3; b++) {
    const rounded = roundEachWay(a, b);
    report(a + " / " + b, () => rounded.map(show).join(" "));
  }
