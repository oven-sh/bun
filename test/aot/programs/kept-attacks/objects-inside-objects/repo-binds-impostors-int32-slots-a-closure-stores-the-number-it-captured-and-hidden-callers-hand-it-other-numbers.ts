// Every call of these functions that the build can see hands over a small integer, which a closure captures and stores into a number field later.
// Five callers that it cannot see, through call, apply, Reflect.apply, bind and a function kept on the global object, hand over fractions, -0, NaN, infinities and integers outside int32.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class ByCall { level = 0; tail = "t"; }
class ByApply { level = 0; tail = "t"; }
class ByReflect { level = 0; tail = "t"; }
class ByBind { level = 0; tail = "t"; }
class ByGlobal { level = 0; tail = "t"; }
function viaCall(gauge: ByCall, level: number) {
  return () => { gauge.level = level; };
}
function viaApply(gauge: ByApply, level: number) {
  return () => { gauge.level = level; };
}
function viaReflect(gauge: ByReflect, level: number) {
  return () => { gauge.level = level; };
}
function viaBind(gauge: ByBind, level: number) {
  return () => { gauge.level = level; };
}
function viaGlobal(gauge: ByGlobal, level: number) {
  return () => { gauge.level = level; };
}
(globalThis as any).kept = viaGlobal;
type Gauge = { level: number; tail: string };
function use(gauge: Gauge) {
  return `${exact(gauge.level)} ${exact(gauge.level + 1)} ${exact(gauge.level * 2)} ${gauge.level | 0} ${exact(1 / gauge.level)} ${gauge.level === gauge.level} ${JSON.stringify(gauge)} [${Object.keys(gauge)}]`;
}
const routes: [string, () => Gauge, (gauge: any, level: number) => () => void, (gauge: any, level: number) => () => void][] = [
  ["call", () => new ByCall(), viaCall, (gauge, level) => viaCall.call(undefined, gauge, level)],
  ["apply", () => new ByApply(), viaApply, (gauge, level) => viaApply.apply(undefined, [gauge, level])],
  ["Reflect.apply", () => new ByReflect(), viaReflect, (gauge, level) => Reflect.apply(viaReflect, undefined, [gauge, level])],
  ["bind", () => new ByBind(), viaBind, (gauge, level) => viaBind.bind(undefined, gauge)(level)],
  ["a global", () => new ByGlobal(), viaGlobal, (gauge, level) => (globalThis as any).kept(gauge, level)],
];
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const a = new ByCall(), b = new ByApply(), c = new ByReflect(), d = new ByBind(), e = new ByGlobal();
  handOver(a); handOver(b); handOver(c); handOver(d); handOver(e);
  viaCall(a, i & 255)();
  viaApply(b, i & 255)();
  viaReflect(c, i & 255)();
  viaBind(d, i & 255)();
  viaGlobal(e, i & 255)();
  sum += a.level + b.level + c.level + d.level + e.level;
}
console.log("warm", sum);
for (const [label, make, , hidden] of routes) {
  for (const value of odd) {
    const gauge = make();
    handOver(gauge);
    hidden(gauge, value)();
    const stored = use(gauge);
    hidden(gauge, 7)();
    console.log(`${label} ${exact(value)}: ${Object.is(gauge.level, 7)} | ${stored}`);
  }
}
