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
const storeInt8 = (view: Int8Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
const storeUint8 = (view: Uint8Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
const storeInt16 = (view: Int16Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
const storeUint16 = (view: Uint16Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
const storeInt32 = (view: Int32Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
const storeUint32 = (view: Uint32Array, value: number) => show(Atomics.store(view, 0, value)) + ":" + view[0];
function storeInEach(value: number): string {
  return [
    storeInt8(new Int8Array(1), value),
    storeUint8(new Uint8Array(1), value),
    storeInt16(new Int16Array(1), value),
    storeUint16(new Uint16Array(1), value),
    storeInt32(new Int32Array(1), value),
    storeUint32(new Uint32Array(1), value),
  ].join(" ");
}
const numbers = [
  2 ** 63,
  -(2 ** 63),
  2 ** 63 + 2048,
  2 ** 64,
  2 ** 62,
  2 ** 53 + 2,
  2 ** 32 + 5,
  2 ** 31,
  -(2 ** 31) - 1,
  1e300,
  -1e300,
  Infinity,
  -Infinity,
  NaN,
  -0,
  1.9,
  -1.9,
];
for (const value of numbers) report(show(value), () => storeInEach(value));
