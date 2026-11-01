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
type Callback = (value: number) => unknown;
function viaCall(callback: Callback, value: number): unknown {
  return callback.call(undefined, value);
}
function viaApply(callback: Callback, value: number): unknown {
  return callback.apply(undefined, [value]);
}
function viaBind(callback: Callback, value: number): unknown {
  return callback.bind(undefined, value)();
}
function typeOfToString(callback: Callback): unknown {
  return typeof callback.toString();
}
function makes(callback: Callback, value: unknown): unknown {
  return value instanceof callback;
}
function describe(label: string, callback: Callback): void {
  attempt(label + ", call", () => viaCall(callback, 2));
  attempt(label + ", apply", () => viaApply(callback, 3));
  attempt(label + ", bind", () => viaBind(callback, 4));
  attempt(label + ", toString", () => typeOfToString(callback));
  attempt(label + ", instanceof", () => makes(callback, {}));
  attempt(label + ", called", () => callback(5));
}
let offset = 0;
const capturing: Callback = function (value) {
  return value * 2 + offset;
};
const capturingNothing: Callback = function (value) {
  return value * 3;
};
const unchanged: Callback = function (value) {
  return value + 100 + offset;
};
function showAll(when: string): void {
  describe(when + ", the closure that captures", capturing);
  describe(when + ", the closure that captures nothing", capturingNothing);
  describe(when + ", the unchanged closure", unchanged);
}
showAll("before");
showAll("before, again");
offset = 1;
for (const changed of [capturing, capturingNothing] as any[]) {
  changed.call = function () {
    return "own call";
  };
  changed.apply = function () {
    return "own apply";
  };
  changed.bind = function () {
    return () => "own bind";
  };
  changed.toString = function () {
    return 5;
  };
}
showAll("after");
showAll("after, again");
export {};
