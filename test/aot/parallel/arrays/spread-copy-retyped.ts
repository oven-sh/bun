// Flags: --aot-check=verify-each-pass
// @ts-nocheck
const show = (value: unknown) => typeof value + " " + String(value);
const say = (label: string, run: () => unknown[]) => console.log(label + ": " + run().map(show).join(" . "));
{
  function f(a: (number | null)[]) { return [...a][0]; }
  say("spread", () => [f(["x"]), f([])]);
}
export {};
