// A call of a value that is declared a function gets closures of several origins, with fewer and more parameters than arguments, bound, async and generator functions, classes, proxies, native functions, and values that cannot be called.
type Callback = (first: number, second: number) => unknown;

const trail: string[] = [];

function attempt(run: () => unknown): string {
  try {
    const value = run();
    if (value instanceof Promise) return "a promise";
    if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
    return String(value);
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function noted(value: number): number {
  trail.push("argument " + value);
  return value;
}
function callIt(callback: Callback): unknown {
  return callback(noted(1), noted(2));
}
function callItAgain(callback: Callback): unknown {
  return callback(3, 4);
}
function callWithNothing(callback: () => unknown): unknown {
  return callback();
}
function look(mark: string, value: unknown): void {
  const callback = value as Callback;
  console.log(mark + ":", attempt(() => callIt(callback)), "|", attempt(() => callIt(callback)), "|", attempt(() => callItAgain(callback)), "|", attempt(() => callWithNothing(callback as () => unknown)), "|", trail.splice(0).length);
}

function adder(offset: number): Callback {
  return (first, second) => first + second + offset;
}
function declared(first: number, second: number): string {
  return "declared " + first + " " + second;
}
function seesThis(this: unknown): string {
  return "this is " + String(this);
}
function counts(): number {
  return arguments.length;
}
function withDefaults(first = 10, second = 20, third = 30): string {
  return [first, second, third].join();
}
function withRest(first: number, ...rest: number[]): string {
  return first + ":" + rest.join();
}
function withPattern({ length }: any = "default", [head]: any = [9]): string {
  return length + "/" + head;
}
class Klass {
  constructor(public first: number) {}
  static method(first: number): string {
    return "static " + first + " " + (this === undefined);
  }
  method(first: number): string {
    return "method " + first + " " + (this === undefined);
  }
}

look("closure", adder(0));
look("closure of the same code", adder(100));
look("closure", adder(0));
look("declared", declared);
look("sees this", seesThis);
look("counts", counts);
look("defaults", withDefaults);
look("rest", withRest);
look("patterns", withPattern);
look("no parameters", () => "nothing");
look("five parameters", (a: number, b: number, c: number, d: number, e: number) => [a, b, c, d, e].join());
look("bound", declared.bind(null, 7));
look("bound twice", declared.bind(null, 7).bind(null, 8));
look("bound this", seesThis.bind("bound"));
look("async", async (first: number) => first);
look("generator", function* (first: number) {
  yield first;
});
look("class", Klass);
look("static method", Klass.method);
look("method", Klass.prototype.method);
look("proxy", new Proxy(declared, {}));
look("proxy with a trap", new Proxy(declared, { apply: (_target, self, list) => "trapped " + String(self) + " " + list.join() }));
look("native", Math.max);
look("native that needs this", Array.prototype.join);
look("native constructor", Map);
look("callable constructor", String);
look("closure", adder(0));
look("undefined", undefined);
look("null", null);
look("number", 5);
look("text", "text");
look("object", {});
look("object with call", { call() {}, apply() {} });
look("array", [declared]);
look("closure", adder(0));

export {};
