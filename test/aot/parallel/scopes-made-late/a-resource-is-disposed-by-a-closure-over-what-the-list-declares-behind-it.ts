const log: string[] = [];
function resource(name: string, atEnd: () => string) {
  return { [Symbol.dispose]() { log.push(name + ":" + atEnd()); } };
}
function run(fail: boolean, seed: number) {
  log.push("in");
  let early = seed;
  using first = resource("first", () => String(early));
  log.push("between");
  let late = seed * 2;
  if (fail) throw new Error("failed " + seed);
  using second = resource("second", () => early + "/" + late);
  late += 1;
  early += 1;
  const read = () => early + late;
  return read();
}
function inABlock(fail: boolean) {
  let outer = 1;
  {
    log.push("block");
    using held = resource("held", () => String(outer));
    let inner = 5;
    if (fail) return "left " + (() => inner)();
    outer += inner;
  }
  return "end " + (() => outer)();
}
console.log(run(false, 1));
try { run(true, 2); } catch (error) { console.log((error as Error).message); }
console.log(inABlock(true), inABlock(false));
console.log(log.join());
