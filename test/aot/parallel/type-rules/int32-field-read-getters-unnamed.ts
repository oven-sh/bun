// Reads an int32 field of an instance that a getter returns. The object with the getter has no name: it is a new object, a call result, an element, a choice.
import type { int32 } from "bun";

class Point {
  x: int32 = 1;
  next: Point | null = null;
  constructor(x: int32 = 1) {
    this.x = x;
  }
}
class Pixel extends Point {
  shade: int32 = 200;
}
class Other {
  x: int32 = 90;
}

const mark: unique symbol = Symbol("mark");
class Factory {
  #kept = new Point(2);
  field: Point = new Point(3);
  accessor stored: Point = new Point(4);
  get point(): Point {
    return new Point(5);
  }
  get maybe(): Point | null {
    return new Point(6);
  }
  get missing(): Point | undefined {
    return undefined;
  }
  get inferred() {
    return new Point(7);
  }
  get pixel(): Pixel {
    return new Pixel(8);
  }
  get either(): Point | Other {
    return this.field.x > 0 ? new Other() : new Point();
  }
  get linked(): Point {
    const first = new Point(9);
    first.next = new Point(10);
    return first;
  }
  get kept(): Point {
    return this.#kept;
  }
  set kept(point: Point) {
    this.#kept = point;
  }
  get #hidden(): Point {
    return new Point(11);
  }
  get self(): this {
    return this;
  }
  get ["computed"](): Point {
    return new Point(12);
  }
  get [mark](): Point {
    return new Point(13);
  }
  static get shared(): Point {
    return new Point(14);
  }
  same(): Factory {
    return this;
  }
  readHidden(): int32 {
    return new Factory().#hidden.x;
  }
}
class Derived extends Factory {}
class Overriding extends Factory {
  override get point(): Point {
    return new Point(15);
  }
  readBase(): int32 {
    return super.point.x;
  }
}
abstract class Shape {
  abstract get center(): Point;
}
class Circle extends Shape {
  get center(): Point {
    return new Point(16);
  }
}
interface HasPoint {
  readonly point: Point;
}
class Holder {
  factory: Factory = new Factory();
  get made(): Factory {
    return new Factory();
  }
}
class Box<Value> {
  constructor(private held: Value) {}
  get value(): Value {
    return this.held;
  }
}

function take(n: int32): int32 {
  return n;
}
function make(): Factory {
  return new Factory();
}
function makeShape(): Shape {
  return new Circle();
}
function makeView(): HasPoint {
  return new Factory();
}
function makeLiteral() {
  return {
    get point(): Point {
      return new Point(17);
    },
  };
}
function makeEither(first: boolean): Factory | Overriding {
  return first ? new Factory() : new Overriding();
}
function pick(): typeof Factory {
  return Factory;
}
function build(constructor: new () => Factory): Factory {
  return new constructor();
}
function tag(texts: TemplateStringsArray): Factory {
  return texts.length > 0 ? new Factory() : new Derived();
}
const list: Factory[] = [new Factory()];
const first = new Factory();
const second: Factory | null = list.length > 0 ? null : new Factory();
const unknown: unknown = new Factory();
let at = 0;
let assigned: Factory;

const results: Record<string, int32> = {
  constructed: take(new Factory().point.x),
  byKeys: take(new Factory()["point"]["x"]),
  byTemplateKey: take(new Factory().point[`x`]),
  optionalField: take(new Factory().point?.x),
  optionalGetter: take(new Factory()?.point.x),
  nonNull: take(new Factory().maybe!.x),
  withDefault: take(new Factory().missing?.x ?? -1),
  callResult: take(make().point.x),
  methodResult: take(first.same().point.x),
  element: take(list[at].point.x),
  chosen: take((at === 0 ? first : list[0]).point.x),
  fallback: take((second ?? first).point.x),
  assignment: take((assigned = new Factory()).point.x),
  cast: take((unknown as Factory).point.x),
  satisfied: take((new Factory() satisfies Factory).point.x),
  awaited: take((await Promise.resolve(new Factory())).point.x),
  tagged: take(tag``.point.x),
  immediatelyCalled: take((() => new Factory())().point.x),
  constructorValue: take(build(Derived).point.x),
  getterOfGetter: take(new Holder().made.point.x),
  getterOfField: take(new Holder().factory.point.x),
  fieldOfGetter: take(new Holder().made.field.x),
  nextOfGetter: take(new Factory().linked.next!.x),
  selfOfNew: take(new Factory().self.field.x),
  inferred: take(new Factory().inferred.x),
  inheritedField: take(new Factory().pixel.x),
  ownFieldOfSubclass: take(new Factory().pixel.shade),
  unionOfClasses: take(new Factory().either.x),
  getterWithSetter: take(new Factory().kept.x),
  autoAccessor: take(new Factory().stored.x),
  privateGetter: take(new Factory().readHidden()),
  computedName: take(new Factory().computed.x),
  symbolName: take(new Factory()[mark].x),
  inheritedGetter: take(new Derived().point.x),
  overridingGetter: take(new Overriding().point.x),
  getterOfBaseClass: take(new Overriding().readBase()),
  abstractGetter: take(makeShape().center.x),
  getterBehindInterface: take(makeView().point.x),
  getterOfLiteral: take(makeLiteral().point.x),
  getterOfInlineLiteral: take(
    {
      get point(): Point {
        return new Point(18);
      },
    }.point.x,
  ),
  getterOfUnion: take(makeEither(at > 0).point.x),
  staticGetterOfCall: take(pick().shared.x),
  staticGetterOfClassExpression: take(
    class {
      static get shared(): Point {
        return new Point(19);
      }
    }.shared.x,
  ),
  genericGetter: take(new Box(new Point(20)).value.x),
  genericGetterWithArgument: take(new Box<Point>(new Point(21)).value.x),
  bothArms: take(at === 0 ? new Factory().point.x : make().point.x),
};
for (const name in results) console.log(name, results[name]);
