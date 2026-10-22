// One function stores into three number fields of one object, and between the stores it reads a field of a second object: an innocent read of a slot, 3000 times over.
// Then a definition that the build cannot attribute turns that field of one second object into an accessor, and the accessor freezes the first object, deletes or redefines the field that is stored next,
// puts a fraction into the field that was stored before, or changes the prototype. What was tested before the read no longer holds behind it.
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
class Target { a = 0; b = 0; c = 0; }
class Other { value = 1; }
function work(target: Target, other: Other, n: number) {
  target.a = n;
  const seen = other.value;
  target.b = n + seen;
  target.c = n;
  return target.a + target.b + target.c;
}
function readsOnly(target: Target, other: Other) {
  const before = target.a;
  const seen = other.value;
  return `${exact(before)} ${seen} ${exact(target.a)} ${exact(target.b)}`;
}
function made<T extends object>(object: T) {
  handOver(object);
  return object;
}
const log: string[] = [];
const effects: [string, (target: Target) => void][] = [
  ["nothing", () => {}],
  ["freeze", target => { Object.freeze(target); }],
  ["seal", target => { Object.seal(target); }],
  ["delete the next field", target => { delete (target as any).b; }],
  ["delete it and close the object", target => { delete (target as any).b; Object.preventExtensions(target); }],
  ["a setter for the next field", target => { Object.defineProperty(target, "b", { set(value: number) { log.push("b = " + exact(value)); }, enumerable: true, configurable: true }); }],
  ["the next field read-only", target => { Object.defineProperty(target, "b", { writable: false }); }],
  ["the last field read-only", target => { Object.defineProperty(target, "c", { value: 0.5, writable: false }); }],
  ["a fraction in the field before", target => { Reflect.set(target, "a", 0.25); }],
  ["a string in the field before", target => { Reflect.set(target, "a", "text"); }],
  ["-0 in the next field", target => { Reflect.set(target, "b", -0); }],
  ["delete all, another prototype with setters", target => {
    for (const name of ["a", "b", "c"]) delete (target as any)[name];
    Object.setPrototypeOf(target, { set b(value: number) { log.push("inherited b = " + exact(value)); }, get a() { return 100; }, c: 7 });
  }],
  ["an undeclared property", target => { (target as any).extra = 1; }],
];
let sum = 0;
for (let i = 0; i < 3000; i++) sum += work(made(new Target()), made(new Other()), i & 31);
console.log("warm", sum);
const name: string = JSON.parse('"value"');
for (const [label, effect] of effects) {
  for (const run of ["stores", "reads"]) {
    const target = made(new Target()), other = made(new Other());
    Object.defineProperty(other, name, { get() { effect(target); return 2; }, configurable: true });
    let outcome: string;
    try {
      outcome = run === "stores" ? exact(work(target, other, 5)) : readsOnly(target, other);
    } catch (error) {
      outcome = (error as Error).constructor.name;
    }
    console.log(`${label}, ${run}: ${outcome} | ${JSON.stringify(target)} [${Object.keys(target)}] ${exact((target as any).a)} ${exact((target as any).b)} ${exact((target as any).c)} ${log.join()}`);
    log.length = 0;
  }
}
console.log("ordinary ones afterwards:", work(made(new Target()), made(new Other()), 5));
