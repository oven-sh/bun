// The prototype of the base is null or changes between two definitions.
function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

function kind(error: unknown): string {
  return error instanceof ReferenceError ? "a ReferenceError" : error instanceof TypeError ? "a TypeError" : "something else";
}

function Old(this: { x: number }): void {
  this.x = 1;
}

const bag: object = { Old };
const Base: new () => { x: number } = Reflect.get(bag, "Old");

class First extends Base {
  extra = "first";
}
console.log("first: " + describe(new First()) + " " + (new First() instanceof Base));

Old.prototype = { hello: () => "hello from the new prototype" };
class Second extends Base {
  extra = "second";
}
console.log("second: " + describe(new Second()) + " has hello: " + ("hello" in new Second()) + " first has hello: " + ("hello" in new First()));

Object.defineProperty(Old, "prototype", { value: null });
class Third extends Base {
  extra = "third";
}
const third = new Third();
console.log("third: " + describe(third) + " has toString: " + ("toString" in third) + " chain: " + (Object.getPrototypeOf(Third.prototype) === null));

Object.defineProperty(Old, "prototype", { value: 5 });
try {
  class Fourth extends Base {
    extra = "fourth";
  }
  console.log("fourth: " + describe(new Fourth()));
} catch (error) {
  console.log("fourth: the definition threw " + kind(error));
}
