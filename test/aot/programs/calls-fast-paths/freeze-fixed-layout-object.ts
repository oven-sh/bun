// Object.freeze() of an object whose layout the compiler knows sets three bits. Of a literal that nobody has touched yet it needs no other way at all.
// CALLS- makeFrozen CallHostFunction
interface Point { x: number; y: number; label?: string; }
function makeFrozen(x: number): Readonly<Point> { return Object.freeze({ x, y: x + 1 }); }
function make(x: number): Point { return { x, y: x + 1 }; }
function freezeLater(point: Point): Readonly<Point> { return Object.freeze(point); }
class Box { wide = 1; tall: number; constructor(tall: number) { this.tall = tall; } }
const show = (label: string, run: () => unknown): void => {
  try { console.log(label, String(run())); } catch (error) { console.log(label, "throws", (error as Error).name); }
};
show("frozen at birth", () => { const point = makeFrozen(1); return [Object.isFrozen(point), Object.isSealed(point), Object.isExtensible(point), point.x, point.y, Object.keys(point).join()].join(); });
show("a store throws", () => { const point = makeFrozen(1) as Point; point.x = 5; return point.x; });
show("the store has not happened", () => { const point = makeFrozen(1) as Point; try { point.x = 5; } catch { } return point.x; });
show("a field is not created", () => { const point = makeFrozen(1) as Point; point.label = "l"; return point.label; });
show("nothing is deleted", () => { const point = makeFrozen(1) as Point; delete point.label; delete (point as any).x; return point.x; });
show("nothing is added", () => { const point: any = makeFrozen(1); point.other = 1; return point.other; });
show("nothing is defined", () => { Object.defineProperty(makeFrozen(1), "x", { value: 9 }); return "defined"; });
show("the descriptor", () => { const d = Object.getOwnPropertyDescriptor(makeFrozen(3), "x")!; return [d.value, d.writable, d.enumerable, d.configurable].join(); });
show("it hands back its argument", () => { const point = make(1); return [freezeLater(point) === point, Object.isFrozen(point)].join(); });
show("frozen later", () => { const point = make(1); point.x = 7; point.label = "l"; freezeLater(point); try { point.x = 8; } catch { } return [point.x, point.label, Object.isFrozen(point)].join(); });
show("frozen twice", () => { const point = make(1); return [freezeLater(freezeLater(point) as Point) === point, Object.isFrozen(point)].join(); });
show("sealed, then frozen", () => { const point = make(1); Object.seal(point); point.x = 4; freezeLater(point); try { point.x = 5; } catch { } return [point.x, Object.isFrozen(point)].join(); });
show("not extensible, then frozen", () => { const point = make(1); Object.preventExtensions(point); freezeLater(point); return [Object.isFrozen(point), Object.isSealed(point)].join(); });
show("with a property the type does not have", () => { const point = make(1); (point as any).other = [1]; freezeLater(point); try { (point as any).other = 2; } catch { } return [String((point as any).other), Object.isFrozen(point), Object.keys(point).join()].join(); });
show("one is frozen, the next is not", () => { const a = make(1), b = make(2); freezeLater(a); b.x = 9; return [Object.isFrozen(a), Object.isFrozen(b), b.x].join(); });
show("an instance", () => { const box = Object.freeze(new Box(2)); try { (box as Box).tall = 3; } catch { } return [box.tall, box.wide, Object.isFrozen(box)].join(); });
show("a copy of a frozen one is not frozen", () => { const copy: Point = { ...makeFrozen(1) }; copy.x = 6; return [copy.x, Object.isFrozen(copy)].join(); });
show("the function as a value", () => [makeFrozen, makeFrozen].map((f, i) => Object.isFrozen(f(i))).join());
show("what is no object", () => [Object.freeze(1), Object.freeze("s"), Object.freeze(null), Object.freeze(undefined)].join());
let total = 0;
for (let i = 0; i < 5000; i++) { const point = i & 1 ? makeFrozen(i) : freezeLater(make(i)); total += point.x + point.y + (Object.isFrozen(point) ? 1 : 1000000); }
console.log(total);
