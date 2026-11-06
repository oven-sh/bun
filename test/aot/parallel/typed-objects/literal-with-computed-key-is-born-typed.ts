// `{ id, label: "x", [key]: id }` where a declared record type is expected is created with the record's layout; the property under the computed key is defined on it. Every line reads as in plain Bun.
// IRT= 1 withKey : =?L[0-9]+ = NewObject 
// IRT= 0 withKey = NewPlainObject
// IRT= 1 withTwoKeys : =?L[0-9]+ = NewObject 
// IRT= 0 namedBehindKey : =?L[0-9]+ = NewObject 
// IRT= 0 lacksMember : =?L[0-9]+ = NewObject 
interface Named { id: number; label: string; note?: string }
function withKey(key: string, id: number): Named { return { id, label: "x", [key]: id }; }
function withTwoKeys(first: string | symbol, second: string | number, id: number): Named { return { id, label: "y", note: "n", [first]: id, [second]: "s" }; }
function namedBehindKey(key: string, id: number): Named { return { id, [key]: id, label: "z" }; }
function lacksMember(key: string, id: number): Named { return { id, [key]: "from the key" } as unknown as Named; }
function sample(): Named { return { id: 0, label: "" }; }

function show(what: string, make: () => Named): void {
  try {
    const made = make();
    const keys = Reflect.ownKeys(made).map(String).join();
    const plain = made as unknown as Record<string, unknown>;
    console.log(what + ": " + made.id + " " + made.label + " " + made.note + " | " + keys + " | " + JSON.stringify(made) + " | " + (Object.getPrototypeOf(made) === Object.prototype) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(plain, keys.split(",").pop()!)));
  } catch (error) {
    console.log(what + ": " + (error as Error).name);
  }
}

const withKeys: ((key: string, id: number) => Named)[] = [withKey, namedBehindKey, lacksMember];
const withTwo: ((first: string | symbol, second: string | number, id: number) => Named)[] = [withTwoKeys];
console.log(JSON.stringify(sample()));
show("another name", () => withKeys[0]!("extra", 1));
show("a member's name, fitting value", () => withKeys[0]!("id", 3));
show("an index", () => withKeys[0]!("0", 5));
show("__proto__", () => withKeys[0]!("__proto__", 6));
show("the empty name", () => withKeys[0]!("", 7));
show("constructor", () => withKeys[0]!("constructor", 8));
show("two names", () => withTwo[0]!("a", "b", 9));
show("the same name twice", () => withTwo[0]!("a", "a", 10));
show("a symbol and a number", () => withTwo[0]!(Symbol.iterator, 1.5, 11));
show("a named member behind the key", () => withKeys[1]!("extra", 12));
show("a named member behind the key, same name", () => withKeys[1]!("label", 13));
show("the key supplies the member", () => withKeys[2]!("label", 14));

const names = ["k0", "k1", "k2", "k3"];
const held: Named[] = [];
for (let i = 0; i < 4000; i++) held.push(withKeys[0]!(names[i & 3]!, i));
let total = 0;
for (const made of held) total += made.id + made.label.length + ((made as unknown as Record<string, number>)[names[made.id & 3]!] ?? -1000000);
console.log(total);
