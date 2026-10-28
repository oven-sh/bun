// A prototype that would close a cycle is refused where the functions and classes have types. They go on as they were.
function show(label: string, run: () => unknown) {
  try {
    console.log(label, String(run()));
  } catch (error: any) {
    console.log(label, "throws", error.constructor.name, error.message);
  }
}

interface Made {
  x: number;
  hello(): string;
}
interface MakerOf<T> {
  new (): T;
  prototype: T;
}

console.log("a function declared as a constructor");
const Declared = function (this: Made) {
  this.x = 1;
} as unknown as MakerOf<Made>;
Declared.prototype.hello = function (this: Made) {
  return "maker " + this.x;
};
class BelowDeclared extends Declared {
  y: number = 2;
  hi(): string {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => Object.setPrototypeOf(Declared.prototype, BelowDeclared.prototype) === Declared.prototype);
show("link", () => Reflect.setPrototypeOf(Declared.prototype, BelowDeclared.prototype));
show("link", () => {
  (Declared.prototype as any).__proto__ = BelowDeclared.prototype;
  return "stored";
});
show("  objects", () =>
  [Object.keys(new Declared()), Object.keys(new BelowDeclared()), new BelowDeclared().hi()].join(" | "),
);
show("  absent", () => [(new Declared() as any).absent, (new BelowDeclared() as any).absent].join());
show("  instanceof", () => [new BelowDeclared() instanceof Declared, new Declared() instanceof BelowDeclared].join());

console.log("a function whose type is set aside");
function Untyped(this: any) {
  this.x = 1;
}
Untyped.prototype.hello = function (this: any) {
  return "maker " + this.x;
};
class BelowUntyped extends (Untyped as any) {
  y: number = 2;
  hi(): string {
    return "target " + this.y + " " + (this as any).hello();
  }
}
show("link", () => Object.setPrototypeOf(Untyped.prototype, BelowUntyped.prototype) === Untyped.prototype);
show("link", () => Reflect.setPrototypeOf(Untyped.prototype, BelowUntyped.prototype));
show("  objects", () =>
  [Object.keys(new (Untyped as any)()), Object.keys(new BelowUntyped()), new BelowUntyped().hi()].join(" | "),
);
show("  instanceof", () =>
  [new BelowUntyped() instanceof Untyped, new (Untyped as any)() instanceof BelowUntyped].join(),
);

console.log("a new prototype object");
const Replaced = function (this: Made) {
  this.x = 1;
} as unknown as MakerOf<Made>;
Replaced.prototype.hello = function (this: Made) {
  return "maker " + this.x;
};
class BelowReplaced extends Replaced {
  y: number = 2;
}
(Replaced as any).prototype = Object.create(BelowReplaced.prototype);
show("  objects", () =>
  [
    Object.keys(new Replaced()),
    Object.keys(new BelowReplaced()),
    new Replaced().hello(),
    new BelowReplaced().hello(),
  ].join(" | "),
);
show("  instanceof", () => [new BelowReplaced() instanceof Replaced, new Replaced() instanceof BelowReplaced].join());

console.log("a link that never runs");
const Kept = function (this: Made) {
  this.x = 1;
} as unknown as MakerOf<Made>;
class BelowKept extends Kept {
  y: number = 2;
}
if ((globalThis as any).nobodySetsThis) Object.setPrototypeOf(Kept.prototype, BelowKept.prototype);
let sum = 0;
for (let turn = 0; turn < 1000; turn++) sum += new BelowKept().y + new BelowKept().x + new Kept().x;
console.log(sum);

console.log("two classes");
class Base {
  x: number = 1;
}
class Derived extends Base {
  y: number = 2;
}
show("link", () => Object.setPrototypeOf(Base.prototype, Derived.prototype) === Base.prototype);
show("link", () => Reflect.setPrototypeOf(Base.prototype, Derived.prototype));
show("link", () => Reflect.setPrototypeOf(Base, Derived));
show("  objects", () =>
  [
    Object.keys(new Base()),
    Object.keys(new Derived()),
    new Derived() instanceof Base,
    new Base() instanceof Derived,
  ].join(" | "),
);
