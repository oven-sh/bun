// `new` of a function gives back the object that the function got as `this`, unless the function returns a value. In a compile build it has the type that the function declares for `this`, where the callee is a binding that holds that function and no other.
interface Point {
  x: number;
}
interface Box<T> {
  value: T;
}
function Declared(this: Point, x: number) {
  this.x = x;
}
new Declared(1);
const Held = function (this: Point, x: number) {
  this.x = x;
};
new Held(1);
function Generic<T>(this: Box<T>, value: T) {
  this.value = value;
}
new Generic("a");
function Leaving(this: Point, x: number) {
  if (x < 0) return;
  this.x = x;
}
new Leaving(1);
function Returning(this: Point, x: number) {
  this.x = x;
  return { x };
}
new Returning(1);
function Undeclared(x: number) {}
new Undeclared(1);
let Stored = function (this: Point) {};
Stored = function (this: Point) {};
new Stored();
const Renamed: typeof Declared = Returning;
new Renamed(1);
function OfNumber(this: number) {}
new OfNumber();
function OfDate(this: Date) {}
new OfDate();
function OfFunction(this: { (): void; x: number }) {}
new OfFunction();
function OfEither(this: Point | Box<number>) {}
new OfEither();
function Guarded(this: Point, x: number) {
  if (!(this instanceof Guarded)) return new Guarded(x);
  this.x = x;
}
new Guarded(1);
function GuardedUnderCasts(this: Point, x: number) {
  if (!(this instanceof GuardedUnderCasts)) return new (GuardedUnderCasts as any)(x) as Point;
  this.x = x;
}
new GuardedUnderCasts(1);
function GivesAnother(this: Point, x: number) {
  if (x < 0) return new Declared(x);
  this.x = x;
}
new GivesAnother(1);
interface Merged {
  x: number;
}
function Merged(this: Merged, x: number) {
  if (!(this instanceof Merged)) return new Merged(x);
  this.x = x;
}
new Merged(1);
