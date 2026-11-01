// The result of one awaited step of an async generator is the loop variable while the next step runs, inside try blocks and loops.
// Flags: --aot-check=verify-each-pass --aot-heat=everything-is-hot
const log = [];
const make = (name, value) => () => name + value;
const show = (value, depth = 0) => {
  try {
    return typeof value === "function"
      ? depth > 3
        ? "function"
        : "function:" + show(value(), depth + 1)
      : (JSON.stringify(value) ?? String(value));
  } catch (error) {
    return "threw " + error.name;
  }
};
const tell = (where, ...values) => log.push(where + ": " + values.map(value => show(value)).join(" | "));
function* counted(turn, list) {
  for (const each of list) yield turn + each;
}
async function* patterned(
  turn,
  p0 = () => 7,
  p1 = make("p1", p0),
  { inner: p2, ...p2rest },
  { deep: { inner: p3 } = { inner: "none" } },
) {
  yield [turn, p0, p1, p2, p2rest, p3];
  yield p3;
}
async function main() {
  try {
    let sent = 0;
    const steps = counted(0, [1, 2, 3]);
    for (let step = steps.next(); !step.done; step = steps.next(++sent)) tell("yielded", step.value);
  } catch (error) {
    tell("thrown", error.name);
  }
  try {
    let sent = 0;
    const steps = counted(1, [4]);
    for (let step = steps.next(); !step.done; step = steps.next(++sent)) tell("yielded", step.value);
  } catch (error) {
    tell("thrown", error.name);
  }
  try {
    let sent = 0;
    const steps = patterned(0, { inner: void 0 }, 1, make("given", 1), { inner: 5, deep: { inner: 6 }, more: 7 });
    for (let step = await steps.next(); !step.done; step = await steps.next(++sent)) tell("yielded", step.value);
  } catch (error) {
    tell("thrown", error.name);
  }
  try {
    let sent = 0;
    const steps = patterned(2, make("given", 1), [1, 2, 3], 2.5);
    for (let step = await steps.next(); !step.done; step = await steps.next(++sent)) tell("yielded", step.value);
  } catch (error) {
    tell("thrown", error.name);
  }
  for (let turn = 3; turn < 30; turn++) {
    try {
      let sent = 0;
      const steps = patterned(
        turn,
        [],
        { inner: 5, deep: { inner: 6 }, more: 7 },
        null,
        { inner: make("inner", 2), deep: void 0 },
        "text",
      );
      for (let step = await steps.next(); !step.done; step = await steps.next(++sent)) tell("yielded", step.value);
    } catch (error) {
      tell("thrown", error.name);
    }
  }
  try {
    let sent = 0;
    const steps = patterned(30, undefined, undefined, { inner: 1, more: 2 }, {});
    for (let step = await steps.next(); !step.done; step = await steps.next(++sent)) tell("yielded", step.value);
    const again = patterned(31, undefined, undefined, { inner: 1 }, { deep: { inner: 9 } });
    for (let step = await again.next(); !step.done; step = await again.next(++sent)) tell("yielded", step.value);
  } catch (error) {
    tell("thrown", error.name);
  }
  for (let turn = 32; turn < 60; turn++) {
    try {
      let sent = 0;
      const steps = patterned(turn, undefined, turn, { inner: turn }, turn & 1 ? {} : undefined);
      for (let step = await steps.next(); !step.done; step = await steps.next(++sent)) tell("yielded", step.value);
    } catch (error) {
      tell("thrown", error.name);
    }
  }
  console.log(log.length);
  console.log(log.slice(0, 12).join("\n"));
  console.log(log.slice(-6).join("\n"));
}
main();
