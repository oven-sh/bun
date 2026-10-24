"use strict";

const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

function Old(x, y) {
  this.x = x;
  this.y = y;
}
function Child(x, y) {
  Old.call(this, x, y);
  this.z = 3;
}
Child.prototype = Object.create(Old.prototype);
Child.prototype.constructor = Child;
function GrandChild(x, y) {
  Child.call(this, x, y);
  this.w = 4;
}
GrandChild.prototype = Object.create(Child.prototype);
GrandChild.prototype.constructor = GrandChild;
function Unrelated(x, y) {
  this.b = y;
  this.a = x;
}
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
class DerivedPoint extends Point {
  z = 3;
}
class ClassOverOld extends Old {
  constructor(x, y) {
    super(x, y);
    this.v = 5;
  }
}
function OldOverClass(x, y) {
  const made = Reflect.construct(Point, [x, y], new.target || OldOverClass);
  made.u = 6;
  return made;
}
OldOverClass.prototype = Object.create(Point.prototype);
OldOverClass.prototype.constructor = OldOverClass;

function describe(made, prototype) {
  return Object.keys(made).map(key => key + " " + show(made[key])).join(", ") + (Object.getPrototypeOf(made) === prototype ? "" : ", another prototype");
}

for (let i = 0; i < 1000; i++) {
  new Old(1, 2);
  new Child(1, 2);
  new GrandChild(1, 2);
  new Unrelated(1, 2);
  new Point(1, 2);
  new DerivedPoint(1, 2);
  new ClassOverOld(1, 2);
  new OldOverClass(1, 2);
}

attempt("Old", () => describe(new Old(1, 2), Old.prototype));
attempt("Old for Child", () => describe(Reflect.construct(Old, [1, 2], Child), Child.prototype));
attempt("Old for GrandChild", () => describe(Reflect.construct(Old, [1, 2], GrandChild), GrandChild.prototype));
attempt("Old for Unrelated", () => describe(Reflect.construct(Old, [1, 2], Unrelated), Unrelated.prototype));
attempt("Old for Point", () => describe(Reflect.construct(Old, [1, 2], Point), Point.prototype));
attempt("Old for DerivedPoint", () => describe(Reflect.construct(Old, [1, 2], DerivedPoint), DerivedPoint.prototype));
attempt("Old for ClassOverOld", () => describe(Reflect.construct(Old, [1, 2], ClassOverOld), ClassOverOld.prototype));
attempt("Old for OldOverClass", () => describe(Reflect.construct(Old, [1, 2], OldOverClass), OldOverClass.prototype));
attempt("Old again", () => describe(new Old(1, 2), Old.prototype));

attempt("Child", () => describe(new Child(1, 2), Child.prototype));
attempt("Child for Old", () => describe(Reflect.construct(Child, [1, 2], Old), Old.prototype));
attempt("Child for GrandChild", () => describe(Reflect.construct(Child, [1, 2], GrandChild), GrandChild.prototype));
attempt("Child for Unrelated", () => describe(Reflect.construct(Child, [1, 2], Unrelated), Unrelated.prototype));
attempt("Child for Point", () => describe(Reflect.construct(Child, [1, 2], Point), Point.prototype));
attempt("Child for DerivedPoint", () => describe(Reflect.construct(Child, [1, 2], DerivedPoint), DerivedPoint.prototype));
attempt("Child for ClassOverOld", () => describe(Reflect.construct(Child, [1, 2], ClassOverOld), ClassOverOld.prototype));
attempt("Child for OldOverClass", () => describe(Reflect.construct(Child, [1, 2], OldOverClass), OldOverClass.prototype));
attempt("Child again", () => describe(new Child(1, 2), Child.prototype));

attempt("GrandChild", () => describe(new GrandChild(1, 2), GrandChild.prototype));
attempt("GrandChild for Old", () => describe(Reflect.construct(GrandChild, [1, 2], Old), Old.prototype));
attempt("GrandChild for Child", () => describe(Reflect.construct(GrandChild, [1, 2], Child), Child.prototype));
attempt("GrandChild for Unrelated", () => describe(Reflect.construct(GrandChild, [1, 2], Unrelated), Unrelated.prototype));
attempt("GrandChild for Point", () => describe(Reflect.construct(GrandChild, [1, 2], Point), Point.prototype));
attempt("GrandChild for DerivedPoint", () => describe(Reflect.construct(GrandChild, [1, 2], DerivedPoint), DerivedPoint.prototype));
attempt("GrandChild for ClassOverOld", () => describe(Reflect.construct(GrandChild, [1, 2], ClassOverOld), ClassOverOld.prototype));
attempt("GrandChild for OldOverClass", () => describe(Reflect.construct(GrandChild, [1, 2], OldOverClass), OldOverClass.prototype));
attempt("GrandChild again", () => describe(new GrandChild(1, 2), GrandChild.prototype));

attempt("Unrelated", () => describe(new Unrelated(1, 2), Unrelated.prototype));
attempt("Unrelated for Old", () => describe(Reflect.construct(Unrelated, [1, 2], Old), Old.prototype));
attempt("Unrelated for Child", () => describe(Reflect.construct(Unrelated, [1, 2], Child), Child.prototype));
attempt("Unrelated for GrandChild", () => describe(Reflect.construct(Unrelated, [1, 2], GrandChild), GrandChild.prototype));
attempt("Unrelated for Point", () => describe(Reflect.construct(Unrelated, [1, 2], Point), Point.prototype));
attempt("Unrelated for DerivedPoint", () => describe(Reflect.construct(Unrelated, [1, 2], DerivedPoint), DerivedPoint.prototype));
attempt("Unrelated for ClassOverOld", () => describe(Reflect.construct(Unrelated, [1, 2], ClassOverOld), ClassOverOld.prototype));
attempt("Unrelated for OldOverClass", () => describe(Reflect.construct(Unrelated, [1, 2], OldOverClass), OldOverClass.prototype));
attempt("Unrelated again", () => describe(new Unrelated(1, 2), Unrelated.prototype));

attempt("Point", () => describe(new Point(1, 2), Point.prototype));
attempt("Point for Old", () => describe(Reflect.construct(Point, [1, 2], Old), Old.prototype));
attempt("Point for Child", () => describe(Reflect.construct(Point, [1, 2], Child), Child.prototype));
attempt("Point for GrandChild", () => describe(Reflect.construct(Point, [1, 2], GrandChild), GrandChild.prototype));
attempt("Point for Unrelated", () => describe(Reflect.construct(Point, [1, 2], Unrelated), Unrelated.prototype));
attempt("Point for DerivedPoint", () => describe(Reflect.construct(Point, [1, 2], DerivedPoint), DerivedPoint.prototype));
attempt("Point for ClassOverOld", () => describe(Reflect.construct(Point, [1, 2], ClassOverOld), ClassOverOld.prototype));
attempt("Point for OldOverClass", () => describe(Reflect.construct(Point, [1, 2], OldOverClass), OldOverClass.prototype));
attempt("Point again", () => describe(new Point(1, 2), Point.prototype));

attempt("DerivedPoint", () => describe(new DerivedPoint(1, 2), DerivedPoint.prototype));
attempt("DerivedPoint for Old", () => describe(Reflect.construct(DerivedPoint, [1, 2], Old), Old.prototype));
attempt("DerivedPoint for Child", () => describe(Reflect.construct(DerivedPoint, [1, 2], Child), Child.prototype));
attempt("DerivedPoint for GrandChild", () => describe(Reflect.construct(DerivedPoint, [1, 2], GrandChild), GrandChild.prototype));
attempt("DerivedPoint for Unrelated", () => describe(Reflect.construct(DerivedPoint, [1, 2], Unrelated), Unrelated.prototype));
attempt("DerivedPoint for Point", () => describe(Reflect.construct(DerivedPoint, [1, 2], Point), Point.prototype));
attempt("DerivedPoint for ClassOverOld", () => describe(Reflect.construct(DerivedPoint, [1, 2], ClassOverOld), ClassOverOld.prototype));
attempt("DerivedPoint for OldOverClass", () => describe(Reflect.construct(DerivedPoint, [1, 2], OldOverClass), OldOverClass.prototype));
attempt("DerivedPoint again", () => describe(new DerivedPoint(1, 2), DerivedPoint.prototype));

attempt("ClassOverOld", () => describe(new ClassOverOld(1, 2), ClassOverOld.prototype));
attempt("ClassOverOld for Old", () => describe(Reflect.construct(ClassOverOld, [1, 2], Old), Old.prototype));
attempt("ClassOverOld for Child", () => describe(Reflect.construct(ClassOverOld, [1, 2], Child), Child.prototype));
attempt("ClassOverOld for GrandChild", () => describe(Reflect.construct(ClassOverOld, [1, 2], GrandChild), GrandChild.prototype));
attempt("ClassOverOld for Unrelated", () => describe(Reflect.construct(ClassOverOld, [1, 2], Unrelated), Unrelated.prototype));
attempt("ClassOverOld for Point", () => describe(Reflect.construct(ClassOverOld, [1, 2], Point), Point.prototype));
attempt("ClassOverOld for DerivedPoint", () => describe(Reflect.construct(ClassOverOld, [1, 2], DerivedPoint), DerivedPoint.prototype));
attempt("ClassOverOld for OldOverClass", () => describe(Reflect.construct(ClassOverOld, [1, 2], OldOverClass), OldOverClass.prototype));
attempt("ClassOverOld again", () => describe(new ClassOverOld(1, 2), ClassOverOld.prototype));

attempt("OldOverClass", () => describe(new OldOverClass(1, 2), OldOverClass.prototype));
attempt("OldOverClass for Old", () => describe(Reflect.construct(OldOverClass, [1, 2], Old), Old.prototype));
attempt("OldOverClass for Child", () => describe(Reflect.construct(OldOverClass, [1, 2], Child), Child.prototype));
attempt("OldOverClass for GrandChild", () => describe(Reflect.construct(OldOverClass, [1, 2], GrandChild), GrandChild.prototype));
attempt("OldOverClass for Unrelated", () => describe(Reflect.construct(OldOverClass, [1, 2], Unrelated), Unrelated.prototype));
attempt("OldOverClass for Point", () => describe(Reflect.construct(OldOverClass, [1, 2], Point), Point.prototype));
attempt("OldOverClass for DerivedPoint", () => describe(Reflect.construct(OldOverClass, [1, 2], DerivedPoint), DerivedPoint.prototype));
attempt("OldOverClass for ClassOverOld", () => describe(Reflect.construct(OldOverClass, [1, 2], ClassOverOld), ClassOverOld.prototype));
attempt("OldOverClass again", () => describe(new OldOverClass(1, 2), OldOverClass.prototype));
