// A method call expects the method of the class. One instance gets a property of its own under that name: a closure, a bound function, a method of another class, a getter, something that cannot be called. Other instances go on as before.
class Greeter {
  name = "greeter";
  greet(to: string): string {
    return this.name + " greets " + to;
  }
  twice(to: string): string {
    return this.greet(to) + " and " + this.greet(to);
  }
}
class Stranger {
  name = "stranger";
  greet(to: string): string {
    return this.name + " ignores " + to;
  }
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function greet(greeter: Greeter): string {
  return greeter.greet("you");
}
function greetTwice(greeter: Greeter): string {
  return greeter.twice("them");
}
function look(mark: string, greeter: Greeter): void {
  console.log(mark + ":", attempt(() => greet(greeter)), "|", attempt(() => greetTwice(greeter)), "|", attempt(() => greet(untouched)));
}

const untouched = new Greeter();
const changed = new Greeter();
const open = changed as any;
let reads = 0;

look("at first", changed);
open.greet = function (this: Greeter, to: string) {
  return this.name + " has its own way with " + to;
};
look("a function of its own", changed);
open.greet = (to: string) => "an arrow for " + to;
look("an arrow", changed);
open.greet = Stranger.prototype.greet;
look("the method of another class", changed);
open.greet = Stranger.prototype.greet.bind(new Stranger());
look("bound to another object", changed);
open.greet = Greeter.prototype.greet;
look("the same method, as its own property", changed);
Object.defineProperty(changed, "greet", {
  get() {
    reads++;
    return (to: string) => "read " + reads + " for " + to;
  },
  configurable: true,
});
look("a getter", changed);
Object.defineProperty(changed, "greet", { value: undefined, writable: true, configurable: true });
look("undefined", changed);
open.greet = null;
look("null", changed);
open.greet = 5;
look("a number", changed);
open.greet = {};
look("an object", changed);
open.greet = class {
  constructor() {}
};
look("a class", changed);
open.greet = new Proxy(Greeter.prototype.greet, {
  apply(target, self, list) {
    return "trapped: " + Reflect.apply(target, self, list);
  },
});
look("a proxy", changed);
open.greet = String.prototype.toUpperCase;
look("a native function", changed);
delete open.greet;
look("deleted", changed);

export {};
