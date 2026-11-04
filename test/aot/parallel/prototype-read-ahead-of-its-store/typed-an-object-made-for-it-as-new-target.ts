interface ShapeLike { area(): number }
function Shape(this: ShapeLike) {}
const old = Reflect.construct(Object, [], Shape as any);
Shape.prototype = {};
Object.getPrototypeOf(old).area = function () { return 7; };
const Make = Shape as unknown as new () => ShapeLike;
function measure(): number { return new Make().area(); }
const attempt = (f: () => unknown) => { try { return f(); } catch (e) { return "threw " + (e as Error).name; } };
let said = "";
for (let i = 0; i < 300; i++) said = String(attempt(measure));
console.log(said);
