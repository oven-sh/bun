interface ShapeLike { area(): number }
function Shape(this: ShapeLike) {}
class Round extends (Shape as unknown as new () => ShapeLike) {}
Shape.prototype = {};
(Shape.prototype as any).area = function () { return 8; };
(Round.prototype as any).__proto__.area = function () { return 7; };
const Make = Shape as unknown as new () => ShapeLike;
function measure(): number { return new Make().area(); }
const attempt = (f: () => unknown) => { try { return f(); } catch (e) { return "threw " + (e as Error).name; } };
let said = "";
for (let i = 0; i < 300; i++) said = String(attempt(measure));
console.log(said);
