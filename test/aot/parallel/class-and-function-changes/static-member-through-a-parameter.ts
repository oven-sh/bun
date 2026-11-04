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
class A {
  static x = 1;
}
class B extends A {}
function read(kind: typeof A): unknown {
  return kind.x;
}
function store(kind: typeof A, value: number): void {
  kind.x = value;
}
function showAll(when: string): void {
  attempt(when + ", A", () => read(A));
  attempt(when + ", B", () => read(B));
}
showAll("as declared");
showAll("as declared, again");
A.x = 2;
showAll("assigned");
store(A, 3);
showAll("assigned through the parameter");
store(B, 4);
showAll("assigned on the subclass");
(A as any).x = "a string";
showAll("a string");
delete (B as any).x;
showAll("deleted on the subclass");
delete (A as any).x;
showAll("deleted");
Object.defineProperty(A, "x", {
  get() {
    return "computed";
  },
  configurable: true,
});
showAll("a getter");
export {};
