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
async function describe(label: string, callback: Callback): Promise<void> {
  const steps: [string, () => unknown][] = [
    ["call", () => viaCall(callback, 2)],
    ["apply", () => viaApply(callback, 3)],
    ["bind", () => viaBind(callback, 4)],
    ["toString", () => typeOfToString(callback)],
    ["instanceof", () => makes(callback, {})],
  ];
  for (const [step, action] of steps) {
    let outcome: string;
    try {
      outcome = show(await action());
    } catch (error) {
      outcome = (error as Error).name;
    }
    console.log(label + ", " + step + ": " + outcome);
  }
}
const double = function (value: number) {
  return value * 2;
};
const kinds: [string, any][] = [
  ["a function", double],
  ["an arrow function", (value: number) => value * 2],
  [
    "an async function",
    async function (value: number) {
      return value * 2;
    },
  ],
  ["an async arrow function", async (value: number) => value * 2],
  [
    "a generator function",
    function* (value: number) {
      yield value * 2;
    },
  ],
  [
    "an async generator function",
    async function* (value: number) {
      yield value * 2;
    },
  ],
  [
    "a class",
    class Made {
      value: number;
      constructor(value: number) {
        this.value = value;
      }
    },
  ],
  [
    "a method",
    {
      method(value: number) {
        return value * 2;
      },
    }.method,
  ],
  [
    "a getter's function",
    Object.getOwnPropertyDescriptor(
      {
        get got() {
          return 1;
        },
      },
      "got",
    )!.get,
  ],
  ["a bound function", double.bind(null)],
  ["a bound function with an argument", double.bind(null, 7)],
  ["a built-in function", Math.abs],
  ["a host function", btoa],
  ["a proxy for a function", new Proxy(double, {})],
  [
    "a proxy that traps call",
    new Proxy(double, {
      get(target, key, receiver) {
        return key === "call" ? () => "trapped call" : Reflect.get(target, key, receiver);
      },
    }),
  ],
  [
    "an object with call, apply, bind and toString",
    {
      call() {
        return "call of an object";
      },
      apply() {
        return "apply of an object";
      },
      bind() {
        return () => "bind of an object";
      },
      toString() {
        return "a string";
      },
    },
  ],
  ["an empty object", {}],
  ["undefined", undefined],
];
for (const [label, callback] of kinds) {
  await describe("a function", double);
  await describe(label, callback);
}
export {};
