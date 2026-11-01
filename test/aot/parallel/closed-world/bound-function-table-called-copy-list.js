// A function is bound by an arrow that stands in a table, laid into a list, taken out of a copy that concat() makes, and called. It runs.
const log = [];
function show(value) {
  const parent = Object.getPrototypeOf(value);
  const kind =
    parent === Object.prototype || parent === Array.prototype
      ? ""
      : parent === null
        ? "bare "
        : parent.constructor.name + " ";
}
function outcome(run) {
  try {
    const value = run();
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + " " + error.message + (effects ? " | " + effects : "");
  }
}
function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}
const functions = [
  [
    "a bound function",
    () =>
      function (a, b) {
        return [this.tag, a, b];
      }.bind({ tag: "bound" }, "first"),
  ],
];
const objects = [["a proxy", () => logged({ y: 2, x: 1 })]];
function truncates(list) {
  const n = list.find(() => true);
}
function addsOne(list) {
  const n = list.slice(0)[0];
}
function calls(list) {
  const f = list.concat([])[0];
  return f(1);
}
function addsMembers(list) {
  const o = list.flat(0)[0];
}
const table = [
  ["calls", calls, functions],
  ["addsMembers", addsMembers, objects],
];
function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, make] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use([make()]));
  }
}
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  truncates([7]);
  addsOne([7]);
}
