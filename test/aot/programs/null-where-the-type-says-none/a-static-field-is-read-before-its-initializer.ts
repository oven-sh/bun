interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
class Registry { static early: string = Registry.look(); static point: Point = origin; static look(): string { return [Registry.point === undefined, typeof Registry.point, Registry.point?.x ?? "none"].join(); } }
console.log(Registry.early, Registry.look());
attempt("throws", () => { class Other { static early: number = Other.read(); static point: Point = origin; static read(): number { return Other.point.x; } } return Other.early; });
