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
type Size = { width: number; height: number };
type Limits = { title: string; limit?: number };
type Letters = { a: number; b: number };
class Meter {
  log: number[] = [];
  height = 0;
  set width(value: number) {
    this.log.push(value);
  }
}
function copySize(target: Size, source: Size): Size {
  return Object.assign(target, source);
}
function tryCopySize(target: Size, source: Size): unknown {
  try {
    copySize(target, source);
  } catch {
    return ["threw", target];
  }
  return ["copied", target];
}
function copyLimits(target: Limits, source: Limits): unknown {
  const result = Object.assign(target, source);
  return [result === target, Object.keys(result), result.title, show(result.limit)];
}
function copyToMeter(target: Meter, source: Size): unknown {
  const meter = Object.assign(target, source);
  return [meter.log, meter.height, Object.keys(meter)];
}
function replaceA(o: Letters): Letters {
  return { ...o, a: 1 };
}
function freezeSize(size: Size): Size {
  return Object.freeze(size);
}
function fixHeight(size: Size): Size {
  return Object.defineProperty(size, "height", { writable: false });
}
function addDepth(size: Size): Size {
  (size as any).depth = 5;
  return size;
}
const source: Size = { width: 3, height: 4 };
report("equal field types", () => copySize({ width: 1, height: 2 }, source));
report("integers into fractions", () => copySize({ width: 1.5, height: 2.5 }, source));
report("fractions into integers", () => copySize({ width: 1, height: 2 }, { width: 3.25, height: 4.75 }));
report("frozen target", () => tryCopySize(freezeSize({ width: 1, height: 2 }), source));
report("read-only second field", () => tryCopySize(fixHeight({ width: 1, height: 2 }), source));
report("optional field absent", () => copyLimits({ title: "t", limit: 5 }, { title: "s" }));
report("optional field present", () => copyLimits({ title: "t", limit: 5 }, { title: "s", limit: 9 }));
report("optional field undefined", () => copyLimits({ title: "t", limit: 5 }, { title: "s", limit: undefined }));
report("target field still unset", () => copyLimits({ title: "t" }, { title: "s", limit: 9 }));
report("spread, then the same key", () => [replaceA({ a: 5, b: 6 }), Object.keys(replaceA({ a: 7, b: 8 }))]);
report("setter on the target", () => copyToMeter(new Meter(), source));
report("setter on another target", () => copyToMeter(new Meter(), { width: 5, height: 6 }));
report("extra property on the source", () => copySize({ width: 1, height: 2 }, addDepth({ width: 3, height: 4 })));
