// Prints where a stack trace places a conversion that follows a spread in a list or in arguments, and the getters that the rest of an object pattern runs.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("fail");
}
const holder = { f: 5, s: "text", arr: [1], g() { return { h: 1 }; } };
const guarded = { f: 5, get bad() { return fail(); } };
let five = 5;
const inThisFile = /stack-positions-list-spreads-object/;
function placesOf(error) {
  return String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
}
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).slice(0, -2).join(" "));
  }
}
show("let q = [1, ...Array.from([1])]; return `${{ toString: () => fail() }}`;", () => { let q = [1, ...Array.from([1])]; return `${{ toString: () => fail() }}`; });
show("let q = [...holder.arr]; return `${{ toString: () => fail() }}`;", () => { let q = [...holder.arr]; return `${{ toString: () => fail() }}`; });
show("let q = [1, ...holder.arr]; return `${{ toString: () => fail() }}`;", () => { let q = [1, ...holder.arr]; return `${{ toString: () => fail() }}`; });
show("let q = [1, ...holder.arr, 2]; return `${{ toString: () => fail() }}`;", () => { let q = [1, ...holder.arr, 2]; return `${{ toString: () => fail() }}`; });
show("let q = [1, ...holder.arr, pass(2)]; return `${{ toString: () => fail() }}`;", () => { let q = [1, ...holder.arr, pass(2)]; return `${{ toString: () => fail() }}`; });
show("let q = [1, ...pass(holder.arr)]; return `${{ toString: () => fail() }}`;", () => { let q = [1, ...pass(holder.arr)]; return `${{ toString: () => fail() }}`; });
show("let q = [1, ...pass(holder).arr]; return `${{ toString: () => fail() }}`;", () => { let q = [1, ...pass(holder).arr]; return `${{ toString: () => fail() }}`; });
show("let q = [1, ...[2, 3]]; return `${{ toString: () => fail() }}`;", () => { let q = [1, ...[2, 3]]; return `${{ toString: () => fail() }}`; });
show("let q = [1, ...[pass(2), 3]]; return `${{ toString: () => fail() }}`;", () => { let q = [1, ...[pass(2), 3]]; return `${{ toString: () => fail() }}`; });
show("let q = [pass(1), ...[]]; return `${{ toString: () => fail() }}`;", () => { let q = [pass(1), ...[]]; return `${{ toString: () => fail() }}`; });
show("let q = [pass(1), ...\"ab\"]; return `${{ toString: () => fail() }}`;", () => { let q = [pass(1), ..."ab"]; return `${{ toString: () => fail() }}`; });
show("let q = [pass(1), ...(five ? holder.arr : [])]; return `${{ toString: () => fail() }}`;", () => { let q = [pass(1), ...(five ? holder.arr : [])]; return `${{ toString: () => fail() }}`; });
show("let q = [pass(1), ...new Set([1])]; return `${{ toString: () => fail() }}`;", () => { let q = [pass(1), ...new Set([1])]; return `${{ toString: () => fail() }}`; });
show("let q = [...holder.arr, ...holder.arr]; return `${{ toString: () => fail() }}`;", () => { let q = [...holder.arr, ...holder.arr]; return `${{ toString: () => fail() }}`; });
show("return [1, ...holder.arr, `${{ toString: () => fail() }}`];", () => { return [1, ...holder.arr, `${{ toString: () => fail() }}`]; });
show("return [...pass(holder.arr), `${{ toString: () => fail() }}`];", () => { return [...pass(holder.arr), `${{ toString: () => fail() }}`]; });
show("return pass([1, ...holder.arr], `${{ toString: () => fail() }}`);", () => { return pass([1, ...holder.arr], `${{ toString: () => fail() }}`); });
show("let q = pass(1, ...holder.arr); return `${{ toString: () => fail() }}`;", () => { let q = pass(1, ...holder.arr); return `${{ toString: () => fail() }}`; });
show("let q = pass(...holder.arr); return `${{ toString: () => fail() }}`;", () => { let q = pass(...holder.arr); return `${{ toString: () => fail() }}`; });
show("let q = pass(...pass(holder.arr)); return `${{ toString: () => fail() }}`;", () => { let q = pass(...pass(holder.arr)); return `${{ toString: () => fail() }}`; });
show("let q = pass(...holder.arr, 2); return `${{ toString: () => fail() }}`;", () => { let q = pass(...holder.arr, 2); return `${{ toString: () => fail() }}`; });
show("let q = holder.g(...holder.arr); return `${{ toString: () => fail() }}`;", () => { let q = holder.g(...holder.arr); return `${{ toString: () => fail() }}`; });
show("let q = new pass(...holder.arr); return `${{ toString: () => fail() }}`;", () => { let q = new pass(...holder.arr); return `${{ toString: () => fail() }}`; });
show("let q = Math.max(...holder.arr); return `${{ toString: () => fail() }}`;", () => { let q = Math.max(...holder.arr); return `${{ toString: () => fail() }}`; });
show("let q = Math.max(1, ...holder.arr); return `${{ toString: () => fail() }}`;", () => { let q = Math.max(1, ...holder.arr); return `${{ toString: () => fail() }}`; });
show("return pass(...holder.arr, `${{ toString: () => fail() }}`);", () => { return pass(...holder.arr, `${{ toString: () => fail() }}`); });
show("return pass(1, ...pass(holder.arr), `${{ toString: () => fail() }}`);", () => { return pass(1, ...pass(holder.arr), `${{ toString: () => fail() }}`); });
show("let [a, ...b] = holder.arr; return `${{ toString: () => fail() }}`;", () => { let [a, ...b] = holder.arr; return `${{ toString: () => fail() }}`; });
show("let [a, ...b] = pass(holder.arr); return `${{ toString: () => fail() }}`;", () => { let [a, ...b] = pass(holder.arr); return `${{ toString: () => fail() }}`; });
show("let [a] = holder.arr; return `${{ toString: () => fail() }}`;", () => { let [a] = holder.arr; return `${{ toString: () => fail() }}`; });
show("let [a, b] = pass(holder.arr); return `${{ toString: () => fail() }}`;", () => { let [a, b] = pass(holder.arr); return `${{ toString: () => fail() }}`; });
show("let [a = pass(1), b] = holder.arr; return `${{ toString: () => fail() }}`;", () => { let [a = pass(1), b] = holder.arr; return `${{ toString: () => fail() }}`; });
show("let { f, ...b } = guarded; return `${{ toString: () => fail() }}`;", () => { let { f, ...b } = guarded; return `${{ toString: () => fail() }}`; });
show("let { f, ...b } = pass(guarded); return `${{ toString: () => fail() }}`;", () => { let { f, ...b } = pass(guarded); return `${{ toString: () => fail() }}`; });
show("let { f } = pass(holder); return `${{ toString: () => fail() }}`;", () => { let { f } = pass(holder); return `${{ toString: () => fail() }}`; });
show("let { f = pass(1), s } = holder; return `${{ toString: () => fail() }}`;", () => { let { f = pass(1), s } = holder; return `${{ toString: () => fail() }}`; });
show("let a, b; [a, ...b] = holder.arr; return `${{ toString: () => fail() }}`;", () => { let a, b; [a, ...b] = holder.arr; return `${{ toString: () => fail() }}`; });
show("let a, b; ({ f: a, ...b } = guarded); return `${{ toString: () => fail() }}`;", () => { let a, b; ({ f: a, ...b } = guarded); return `${{ toString: () => fail() }}`; });
show("over several lines 1", () => {
  const list = [
    1,
    ...Array.from(
      { length: 2 },
      (_, index) => index,
    ),
  ];
  return `${{ toString: () => fail() }}`;
});
show("over several lines 2", () => {
  const {
    f,
    ...others
  } = guarded;
});
show("over several lines 3", () => {
  let f, others;
  ({
    f,
    ...others
  } = guarded);
});
show("over several lines 4", () => {
  for (const { f, ...others } of [guarded]) pass(others);
});
show("over several lines 5", () => {
  (({ f, ...others }) => others)(guarded);
});
show("over several lines 6", () => {
  try { throw guarded; } catch ({ f, ...others }) { pass(others); }
});
