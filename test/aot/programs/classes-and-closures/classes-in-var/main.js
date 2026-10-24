// `var X = class { .. }`, as esbuild writes every class declaration, imported from another module: `new`, `instanceof`, static methods and `extends`, a variable that is read before its class is there, one that is stored to again, and one that is declared twice.
import { Point, Point3, Bare, Named, Swapped, swap, Early, earlyType, Late, Twice, makeLocal } from "./shapes.js";
import * as shapes from "./shapes.js";
let total = 0;
for (let i = 0; i < 2000; i++) total += new Point(i, 1).sum() + new Point3(i, 1, 2).sum() + Point.origin().sum();
console.log(total, new Point(1, 2) instanceof Point, new Point3(1, 2, 3) instanceof Point, new Point(1, 2) instanceof Point3, Object.keys(new Point3(1, 2, 3)).join());
console.log(Point.name, Point3.name, Bare.name, Named.name, new Named().who(), Object.keys(new Bare()).length, typeof Point, Point.length, Point3.length);
console.log(new Swapped().kind(), new shapes.Swapped().kind());
swap();
console.log(new Swapped().kind(), new shapes.Swapped().kind());
console.log(Early, earlyType, new Late().kind(), new Twice().kind(), makeLocal(4).n() + makeLocal(5).n());
const thrownBy = f => { try { f(); return "nothing"; } catch (error) { return error.constructor.name; } };
console.log(thrownBy(() => Point(1, 2)), thrownBy(() => new Point.origin()), thrownBy(() => Reflect.construct(Point, [1, 2], Bare).sum()), Reflect.construct(Point, [1, 2], Bare) instanceof Bare, Reflect.construct(Point, [3, 4], Point3).x);
Point.prototype.sum = function () { return "replaced"; };
console.log(new Point(1, 2).sum(), new Point3(1, 2, 3).sum());
Object.setPrototypeOf(Point3, Bare);
console.log(thrownBy(() => new Point3(1, 2, 3)), Object.keys(new Point3(1, 2, 3)).join());
