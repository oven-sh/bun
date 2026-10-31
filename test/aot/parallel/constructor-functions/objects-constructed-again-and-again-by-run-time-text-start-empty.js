// Every `new` from text made at run time gets a fresh object: nothing of a collected object shows in the next one, and a new prototype counts at once.
const nothing = String(Date.now()).slice(99);
const construct = new Function("F", "a", "b", "return new F(a, b)" + nothing);

function Empty() {}

function Wide(a, b) {
  this.p0 = a;
  this.p1 = b;
  this.p2 = a + b;
  this.p3 = "three";
  this.p4 = 4.5;
  this.p5 = null;
  this.p6 = undefined;
  this.p7 = true;
  this.p8 = [a];
  if (a % 2) this.p9 = "odd";
}

function Point(x, y) {
  if (!new.target) throw new TypeError("call it with new");
  this.x = x;
  this.y = y;
  if (x % 3 === 0) this.half = x / 2;
}
const origin = new Point(0, 0);

function fill(object, i) {
  for (let k = 0; k < i % 9; k++) object["name" + k] = { i, k };
  return object;
}

let kept = [];
let checksum = 0;
for (let round = 0; round < 6; round++) {
  for (let i = 0; i < 4000; i++) {
    const empty = construct(Empty);
    if (Reflect.ownKeys(empty).length || empty.name0 !== undefined || empty.p0 !== undefined) throw new Error("not empty: " + Reflect.ownKeys(empty));
    fill(empty, i);
    checksum += Object.keys(empty).length;

    const wide = construct(Wide, i, round);
    if (Object.keys(wide).length !== 9 + (i % 2) || wide.p2 !== i + round || wide.p8[0] !== i || "name0" in wide) throw new Error("wide: " + JSON.stringify(wide));

    const point = construct(Point, i, round);
    if (point.x !== i || point.y !== round || "half" in point !== (i % 3 === 0) || point.half !== (i % 3 ? undefined : i / 2)) throw new Error("point: " + JSON.stringify(point));
    if (i % 997 === 0) kept.push(empty, wide, point);
  }
  Bun.gc(true);
  if (round % 2) kept = kept.slice(-6);
}
console.log(checksum, kept.length, JSON.stringify(kept.slice(-3)), JSON.stringify(origin));
console.log(kept.slice(-3).map(object => object.constructor.name + ":" + Object.keys(object).join()).join(" "));

for (const F of [Empty, Wide, Point]) {
  const first = construct(F, 1, 2);
  const before = F.prototype;
  F.prototype = { kind: "other " + F.name };
  const second = construct(F, 1, 2);
  F.prototype = before;
  const third = construct(F, 1, 2);
  before.late = "late " + F.name;
  console.log(first instanceof F, second instanceof F, third instanceof F, second.kind, first.kind, third.late, Object.getPrototypeOf(third) === before, JSON.stringify(second) === JSON.stringify(first));
}

Object.defineProperty(Empty, "prototype", { value: null, writable: false });
console.log(Object.getPrototypeOf(construct(Empty)) === Object.prototype);
console.log(Reflect.construct(Point, [3, 4], Wide) instanceof Wide, Reflect.construct(Wide, [3, 4], Point) instanceof Point, Reflect.construct(Empty, [], Point).late);
