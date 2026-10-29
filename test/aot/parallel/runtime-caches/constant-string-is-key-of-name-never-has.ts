// A string constant that is no property name anywhere in the program is used as a computed key, again and again.
// The name is absent at first; then it appears on the object, on a prototype, in process.env, and goes away again.
const names = ["quite-absent-one", "quite-absent-two", "quite-absent-three", "HOME"];

function reader(holder: Record<string, unknown>, key: string): () => unknown {
  return () => holder[key];
}

function has(holder: object, key: string): boolean {
  return key in holder;
}

function show(label: string, readers: (() => unknown)[], holder: object): void {
  const seen: string[] = [];
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < readers.length; i++) seen.push(String(readers[i]()) + (has(holder, names[i]) ? "+" : "-"));
  }
  console.log(label, seen.join(" "));
}

const parent: Record<string, unknown> = { inheritedFromTheStart: true };
const plain: Record<string, unknown> = Object.assign(Object.create(parent), { a: 1, b: 2 });
const plainReaders = names.map(name => reader(plain, name));
show("absent", plainReaders, plain);
plain[names[0]] = "own";
show("own", plainReaders, plain);
parent[names[1]] = "inherited";
show("inherited", plainReaders, plain);
delete plain[names[0]];
show("deleted", plainReaders, plain);
delete parent[names[1]];
show("gone", plainReaders, plain);

const withoutPrototype: Record<string, unknown> = Object.create(null);
const bareReaders = names.map(name => reader(withoutPrototype, name));
show("bare", bareReaders, withoutPrototype);
Object.setPrototypeOf(withoutPrototype, { [names[2]]: "late parent" });
show("late parent", bareReaders, withoutPrototype);

const environment = process.env as Record<string, unknown>;
const environmentReaders = names.slice(0, 3).map(name => reader(environment, name));
const showEnvironment = (label: string) => console.log(label, environmentReaders.map(read => String(read())).join(" "), environmentReaders.map(read => String(read())).join(" "));
showEnvironment("environment");
process.env[names[0]] = "set";
showEnvironment("environment set");
delete process.env[names[0]];
showEnvironment("environment unset");

const many: Record<string, unknown> = {};
for (let i = 0; i < 300; i++) many["k" + i] = i;
const manyReaders = names.map(name => reader(many, name));
show("many", manyReaders, many);
many[names[2]] = "in a dictionary";
show("many set", manyReaders, many);

const trapped = new Proxy({}, { get: (_, key) => "trap:" + String(key), has: () => true });
show("proxy", names.map(name => reader(trapped as Record<string, unknown>, name)), trapped);
