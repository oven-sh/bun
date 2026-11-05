// Flags: --aot-heat=everything-is-hot
// As loop-whose-comparison-another-block-reads.js: here the loops are those of map(), join() and reduce(), written into their callers.
// @ts-nocheck
const launder = new Function("value", process.argv[9] ?? "return value") as <V>(value: V) => V;
const show = (value: unknown) => typeof value + " " + String(value);
const say = (label: string, run: () => unknown[]) => {
  let line;
  try {
    line = (launder((launder(run())).map(show))).join(" . ");
  } catch (error) {
    line = "THROWS " + String(error);
  }
  console.log(label + " | " + line);
}
{
  function f(a: Array<number | null>) { return (launder([(launder(a))[0], (launder(a))[0]])).reduce(() => (launder(a))[0]); }
  say("in an arrow for reduce()", () => [f([undefined]), f([null])]);
}
