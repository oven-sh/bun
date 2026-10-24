// Something is stored on each of these classes under a name that nobody knows at build time, so what they inherit from their built-in parents is found under a guard.
// The guard holds until the class itself gets the name.
class List extends Array<number> {}
class Bag extends Map<string, number> {}
class Deep extends Bag {
  read(key: string): number {
    return super.get(key) ?? -1;
  }
}
class Other {
  static isArray(_value: unknown): boolean {
    return false;
  }
  static of(..._values: number[]): number[] {
    return [];
  }
  get(_key: string): number {
    return -5;
  }
}

function patch(target: any, key: string, value: unknown): void {
  target[key] = value;
}
const join = (...parts: string[]) => parts.join("");

function ask(values: unknown[], turns: number): number {
  let count = 0;
  for (let i = 0; i < turns; i++) if (List.isArray(values[i & 3])) count++;
  return count;
}
function make(turns: number): number {
  let count = 0;
  for (let i = 0; i < turns; i++) count += List.of(i, i + 1).length;
  return count;
}
function read(deep: Deep, turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += deep.read("k");
  return sum;
}

patch(List, join("ex", "tra"), 1);
patch(Bag.prototype, join("ex", "tra"), 1);

const part = process.env.PART ?? "all";
const turns = Number(process.env.TURNS ?? 20000);
const values: unknown[] = [1, [2], "3", new List()];
const deep = new Deep();
deep.set("k", 3);
const is = (name: string) => part === name || part === "all";

if (is("ask")) console.log("ask", ask(values, turns));
if (is("make")) console.log("make", make(turns));
if (is("read")) console.log("read", read(deep, turns));
if (part === "all") {
  patch(List, join("is", "Array"), () => false);
  console.log("isArray stored on the class", ask(values, 100), make(100));
  delete (List as any).isArray;
  console.log("and deleted", ask(values, 100), make(100));
  Object.defineProperty(List, join("o", "f"), { value: () => [7], configurable: true });
  console.log("of defined on the class", ask(values, 100), make(100));
  delete (List as any).of;
  console.log("and deleted", ask(values, 100), make(100));
  Object.setPrototypeOf(List, Other);
  console.log("another parent", ask(values, 100), make(100));

  patch(Bag.prototype, join("g", "et"), () => -9);
  console.log("get stored on the prototype between", read(deep, 100), deep.get("k"));
  delete (Bag.prototype as any).get;
  console.log("and deleted", read(deep, 100), deep.get("k"));
  Object.setPrototypeOf(Bag.prototype, Other.prototype);
  console.log("another prototype above", read(deep, 100));
}
