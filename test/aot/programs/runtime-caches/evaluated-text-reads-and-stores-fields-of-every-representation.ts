// Evaluated text runs in the interpreter, whose handlers read, test and store the fields of compiled objects in place.
// One field of each representation, every kind of number in the fields that hold doubles. Each access runs often enough to leave its slow path. Output must match plain Bun.
class Fields {
  whole: number = 3;
  ratio: number = 1.5;
  maybeRatio?: number;
  wholeOrNothing: number | null | undefined = 7;
  flag: boolean = true;
  maybeFlag?: boolean;
  name: string = "n";
  kind: "a" | "b" = "a";
  other: Fields | null = null;
  maybeOther?: Fields;
  anything: unknown = 1;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (value instanceof Fields) return "Fields";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

const names = Object.keys(new Fields()).concat("missing");
const readAll = new Function("o", "let r; for (let i = 0; i < 4; i++) r = [" + names.map(name => "o." + name).join() + "]; return r;");
const readByKey = new Function("o", "keys", "let r; for (let i = 0; i < 4; i++) r = keys.map(key => o[key]); return r;");
const testAll = new Function("o", "keys", "let r; for (let i = 0; i < 4; i++) r = [" + names.map(name => JSON.stringify(name) + " in o").join() + "].concat(keys.map(key => key in o)); return r;");
const stores: Record<string, Function> = {};
for (const name of names) stores[name] = new Function("o", "v", "for (let i = 0; i < 4; i++) o." + name + " = v; return o." + name + ";");

function tell(label: string, object: Fields) {
  console.log(label, readAll(object).map(show).join(), "|", readByKey(object, names).map(show).join(), "|", testAll(object, names).map((present: boolean) => (present ? 1 : 0)).join(""));
}

tell("fresh", new Fields());

const numbers = [0, -0, 1, -1, 1.5, -1.5, 0.1 + 0.2, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 9007199254740991, 1e21, 1e300, -1e300, 5e-324, Infinity, -Infinity, NaN];
for (const name of ["whole", "ratio", "maybeRatio", "wholeOrNothing", "anything"]) {
  const object = new Fields();
  const seen: string[] = [];
  for (const number of numbers) {
    seen.push(show(stores[name](object, number)) + ":" + show((object as any)[name]));
  }
  console.log("numbers in", name, seen.join(" "));
  tell("after", object);
}

const values: unknown[] = [undefined, null, true, false, "a", "b", "text", new Fields(), {}, 2, 2.5];
for (const name of names) {
  const seen: string[] = [];
  for (const value of values) {
    const object = new Fields();
    try {
      seen.push(show(stores[name](object, value)) + ":" + show((object as any)[name]) + ":" + (name in object ? 1 : 0));
    } catch (error) {
      seen.push((error as Error).constructor.name);
    }
  }
  console.log("values in", name, seen.join(" "));
}

const frozen = Object.freeze(new Fields());
const strictStore = new Function("o", "v", "'use strict'; o.ratio = v;");
try {
  strictStore(frozen, 2.5);
  console.log("stored in a frozen object");
} catch (error) {
  console.log("frozen", (error as Error).constructor.name, show(frozen.ratio));
}
stores.ratio(frozen, 2.5);
tell("frozen", frozen);

function sumInCompiledCode(object: Fields): number {
  return object.whole + object.ratio + (object.maybeRatio ?? 0) + (object.wholeOrNothing ?? 0);
}
const shared = new Fields();
for (const number of [0.5, 3, -0, 1e300]) {
  stores.ratio(shared, number);
  stores.maybeRatio(shared, number);
  console.log("read by compiled code", show(shared.ratio), show(shared.maybeRatio), show(sumInCompiledCode(shared)));
}

export {};
