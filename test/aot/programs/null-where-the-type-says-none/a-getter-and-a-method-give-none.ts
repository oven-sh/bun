interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
class Box { #point: Point | undefined; constructor(point?: Point) { this.#point = point; } get point(): Point { return this.#point as Point; } take(): Point { return this.#point!; } }
function read(box: Box): number { return box.point.x + box.take().y; }
function test(box: Box): string { return [box.point === undefined, box.take() === undefined, box.point?.x ?? "none"].join(); }
for (const box of [new Box(origin), new Box(), new Box(origin)]) { attempt("read", () => read(box)); attempt("test", () => test(box)); }
