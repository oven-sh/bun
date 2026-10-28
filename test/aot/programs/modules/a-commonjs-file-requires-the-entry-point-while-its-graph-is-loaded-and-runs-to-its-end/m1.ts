// @ts-ignore
export * as allOfm3_0 from "./m3.cjs";
const show = (value: unknown): string =>
  value === null
    ? "null"
    : typeof value === "object" || typeof value === "function"
      ? typeof value +
        "{" +
        Reflect.ownKeys(value)
          .filter(
            key =>
              typeof key === "string" &&
              !["length", "name", "prototype", "arguments", "caller", "__esModule"].includes(key),
          )
          .join() +
        "}"
      : typeof value + ":" + String(value);
const tell = (label: string, read: () => unknown) => {
  let shown;
  try {
    shown = show(read());
  } catch (error) {
    shown = "throws " + (error as Error)?.name;
  }
  console.log(label, shown);
};
const atTheEnd = ((globalThis as any).atTheEnd ??= []) as (() => unknown)[];

export let first = "m1.first";
export const second = { of: "m1" };
export default "m1";
console.log("m1 begins");
atTheEnd.push(async () => {
  try {
    const m0_1 = await import("./main.mjs");
    tell("m1 late import m0", () => m0_1);
    tell("m1 late import m0.second", () => (m0_1 as any).second);
    tell("m1 late import m0.default", () => (m0_1 as any).default);
  } catch (error) {
    console.log("m1 late import m0 throws", (error as Error)?.name);
  }
});
console.log("m1 ends");
