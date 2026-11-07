// STATISTIC: MethodCallsThroughTable >= 1
abstract class Shape { abstract area(): number; twice() { return this.area() * 2; } }
class Square extends Shape { constructor(readonly side: number) { super(); } area() { return this.side * this.side; } }
class Rect extends Shape { constructor(readonly w: number, readonly h: number) { super(); } area() { return this.w * this.h; } }
class Disk extends Shape { constructor(readonly r: number) { super(); } area() { return 3 * this.r * this.r; } }
function twiceOf(shape: Shape) { const twice = shape.twice(); return twice + 1; }
const byValue = [twiceOf];
const shapes: Shape[] = [new Square(2), new Rect(2, 3), new Disk(1)];
let said = "";
for (let turn = 0; turn < 6; turn++) said += byValue[0](shapes[turn % 3]) + ";";
console.log(said);
const bare = new (Shape as any)();
try { console.log(byValue[0](bare)); } catch (error) { console.log((error as Error).constructor.name, (error as Error).message); }
