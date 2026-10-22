// An object gets out of its constructor before all fields are defined: through a call in a field initializer, a method that a subclass overrides, an exception, an early return. A field that is not there yet is absent, not zero and not empty.
const seen: string[] = [];

interface Pair {
  left: number;
  right: string;
}

function leftOf(pair: Pair): unknown {
  return pair.left;
}
function rightOf(pair: Pair): unknown {
  return pair.right;
}
function setRight(pair: Pair, to: string): void {
  pair.right = to;
}
function snapshot(mark: string, pair: Pair): number {
  seen.push(mark + ": " + String(leftOf(pair)) + "," + String(rightOf(pair)) + "," + ("left" in pair) + "," + ("right" in pair) + ",[" + Object.keys(pair).join() + "]");
  return 1;
}
function report(mark: string, value: unknown): void {
  console.log(mark + ":", JSON.stringify(value), "|", seen.splice(0).join(" | "));
}

class InInitializers implements Pair {
  before = snapshot("before left", this);
  left = 5;
  between = snapshot("between", this);
  right = "right";
  after = snapshot("after right", this);
}
report("initializers", new InInitializers());
report("initializers again", new InInitializers());

class Parent {
  parentField = "parent";
  constructor() {
    this.hook();
  }
  hook(): void {}
}
class Child extends Parent implements Pair {
  left = 6;
  right = "child";
  hook(): void {
    snapshot("from the parent's constructor", this);
  }
}
report("overridden hook", new Child());

class StoresEarly extends Parent implements Pair {
  left = 7;
  right = "defined by the initializer";
  hook(): void {
    setRight(this, "stored early");
    snapshot("after the early store", this);
  }
}
report("a store before the definition", new StoresEarly());

let escaped: Pair | undefined;
class Throws implements Pair {
  left = 8;
  middle = (() => {
    escaped = this;
    throw new RangeError("midway");
  })();
  right = "never";
}
try {
  new Throws();
} catch (error) {
  snapshot("after the exception", escaped!);
  setRight(escaped!, "stored afterwards");
  snapshot("after a store", escaped!);
  report("an initializer throws", escaped);
}

class AssignsInConstructor implements Pair {
  declare left: number;
  declare right: string;
  constructor(stopEarly: boolean) {
    snapshot("empty", this);
    this.right = "right first";
    snapshot("right only", this);
    if (stopEarly) return;
    this.left = 9;
  }
}
report("stops early", new AssignsInConstructor(true));
report("runs through", new AssignsInConstructor(false));
report("stops early again", new AssignsInConstructor(true));
const partial = new AssignsInConstructor(true);
seen.length = 0;
partial.left = 10;
snapshot("completed later", partial);
report("completed later", partial);

function OldStyle(this: any, withLeft: boolean) {
  snapshot("old style, empty", this);
  if (withLeft) this.left = 11;
  this.right = "old style";
  snapshot("old style, done", this);
}
report("old style with left", new (OldStyle as any)(true));
report("old style without left", new (OldStyle as any)(false));
report("old style with left", new (OldStyle as any)(true));

export {};
