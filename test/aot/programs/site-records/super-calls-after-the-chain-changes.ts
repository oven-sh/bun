// `super.method()` starts at the prototype of the object that the method was defined in, at the moment of the call. That prototype's method is replaced, deleted, becomes a getter, and the chain is hung elsewhere. `super()` calls whatever the class hangs below.
class Bottom {
  tag = "bottom";
  name(): string {
    return "Bottom.name of " + this.tag;
  }
  static make(): string {
    return "Bottom.make";
  }
}
class Middle extends Bottom {
  name(): string {
    return "Middle.name > " + super.name();
  }
  static make(): string {
    return "Middle.make > " + super.make();
  }
}
class Top extends Middle {
  tag = "top";
  name(): string {
    return "Top.name > " + super.name();
  }
  viaArrow(): string {
    return (() => super.name())();
  }
  static make(): string {
    return "Top.make > " + super.make();
  }
}
class Elsewhere {
  name(): string {
    return "Elsewhere.name of " + (this as any).tag;
  }
  static make(): string {
    return "Elsewhere.make";
  }
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

const top = new Top();
const originalMiddle = Middle.prototype.name;
const borrowed = { tag: "borrower", name: Top.prototype.name };

function look(mark: string): void {
  console.log(mark + ":", attempt(() => top.name()), "|", attempt(() => top.viaArrow()), "|", attempt(() => borrowed.name()), "|", attempt(() => Top.make()));
}

look("at first");
look("again");
Middle.prototype.name = function (this: Bottom) {
  return "replaced Middle.name of " + this.tag;
};
look("Middle.name replaced");
delete (Middle.prototype as any).name;
look("Middle.name deleted");
Object.defineProperty(Middle.prototype, "name", { get: () => () => "from a getter", configurable: true });
look("Middle.name is a getter");
Object.defineProperty(Middle.prototype, "name", { value: 5, writable: true, configurable: true });
look("Middle.name is a number");
Middle.prototype.name = originalMiddle;
look("the original");
Object.setPrototypeOf(Top.prototype, Elsewhere.prototype);
look("Top.prototype hangs elsewhere");
Object.setPrototypeOf(Top.prototype, Middle.prototype);
Object.setPrototypeOf(Middle.prototype, Elsewhere.prototype);
look("Middle.prototype hangs elsewhere");
Object.setPrototypeOf(Middle.prototype, null);
look("Middle.prototype hangs nowhere");
Object.setPrototypeOf(Middle.prototype, Bottom.prototype);
look("as at first");
Object.setPrototypeOf(Top, Elsewhere);
look("Top hangs below Elsewhere");
console.log("constructed:", attempt(() => JSON.stringify(new Top())), attempt(() => new Top() instanceof Middle), attempt(() => new Top().name()));
Object.setPrototypeOf(Top, Middle);
(Middle as any).make = () => "replaced Middle.make";
look("Middle.make replaced");
delete (Middle as any).make;
look("Middle.make deleted");

function Plain(this: any) {
  this.tag = "made by a function";
  this.more = true;
}
Object.setPrototypeOf(Top, Plain);
console.log("below a function:", attempt(() => JSON.stringify(new Top())), attempt(() => new Top().name()));
Object.setPrototypeOf(Top, null);
console.log("below nothing:", attempt(() => new Top()));
Object.setPrototypeOf(Top, Middle);
console.log("as at first:", attempt(() => JSON.stringify(new Top())), attempt(() => new Top().name()));

export {};
