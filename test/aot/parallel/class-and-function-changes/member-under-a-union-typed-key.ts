const opaque = (value: any): any => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
function show(value: unknown): string {
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return typeof value + " " + String(value);
}
function attempt(label: string, action: () => unknown): void {
  let outcome: string;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = (error as Error).name;
  }
  console.log(label + ": " + outcome);
}
class Kinds {
  static alpha = 1;
  static beta = "two";
  static gamma() {
    return 3;
  }
}
type Key = "alpha" | "beta" | "gamma";
function pick(key: Key): unknown {
  return Kinds[key];
}
function pickFrom(holder: typeof Kinds, key: Key): unknown {
  return holder[key];
}
function put(key: "alpha", value: number): void {
  Kinds[key] = value;
}
function has(key: Key): boolean {
  return key in Kinds;
}
function tools() {
  return "called";
}
tools.first = 1;
tools.second = "two";
function pickTool(key: "first" | "second"): unknown {
  return tools[key];
}
const keys: unknown[] = [
  "alpha",
  "beta",
  "gamma",
  "first",
  "second",
  "name",
  "length",
  "prototype",
  "missing",
  "",
  0,
  Symbol.hasInstance,
  {
    toString() {
      return "alpha";
    },
  },
  undefined,
];
function showAll(when: string): void {
  keys.forEach((key, position) => {
    const label = when + ", " + position + " " + show(key);
    attempt(label + ", on the class", () => pick(key as Key));
    attempt(label + ", on the class passed as a parameter", () => pickFrom(Kinds, key as Key));
    attempt(label + ", in the class", () => has(key as Key));
    attempt(label + ", on the function", () => pickTool(key as "first"));
  });
}
showAll("as declared");
put("alpha", 10);
tools.first = 11;
showAll("assigned");
delete (Kinds as any).beta;
delete (tools as any).second;
showAll("deleted");
Object.defineProperty(Kinds, "gamma", {
  get() {
    return "computed";
  },
  configurable: true,
});
Object.defineProperty(tools, "first", {
  get() {
    return "computed";
  },
  configurable: true,
});
showAll("getters");
(Kinds as any).missing = "added";
(tools as any).missing = "added";
showAll("added");
export {};
