// A typed read in front of the two calls is tested, and what follows the test is copied for the values that fail it. The copies join between
// Object.getOwnPropertyDescriptors and Object.defineProperties, and each has described the source for itself.
type Definition = { name: string; make?: (input: unknown) => unknown; [key: string]: unknown };
const DEFAULTS = { isEnabled: () => true, aliases: [] as string[], label: () => "" };

export function build<D extends Definition>(def: D) {
  const make = def.make;
  const created = (input: unknown) => ({ made: typeof make === "function" ? make(input) : make, by: def.name });
  const facing = {
    run(input: unknown) {
      return created(input);
    },
  };
  return Object.assign(Object.defineProperties({ ...DEFAULTS, shownName: () => def.name }, Object.getOwnPropertyDescriptors(def)), facing);
}

const log: string[] = [];
const definitions: any[] = [
  { name: "a", make: (x: unknown) => [x], get schema() { log.push("schema read"); return 1; } },
  { name: "b" },
  { name: "c", make: 7 },
  { name: "d", make: "text", other: 2 },
  new Proxy({ name: "e", make: 1n }, {
    ownKeys(target) { log.push("ownKeys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { log.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
    get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); },
  }),
];
for (const definition of definitions) {
  const built: any = build(definition);
  console.log(Object.keys(built).join(), JSON.stringify(built.run(3), (key, value) => typeof value === "bigint" ? String(value) : value), built.shownName(), log.splice(0).join("|"));
}
for (const odd of [undefined, null]) {
  try {
    build(odd as any);
  } catch (error) {
    console.log((error as Error).name);
  }
}
