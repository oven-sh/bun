interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
let current: Point; let name: string;
function read(): number { return current.x; }
function tested(): string { return [current === undefined, typeof current, name === undefined, current?.y ?? "none"].join(); }
attempt("read", read); attempt("tested", tested);
current = origin; name = "n";
attempt("read", read); attempt("tested", tested);
function inner(): string { var late: Point; const look = () => late === undefined ? "none" : "x " + late.x; const before = look(); late = origin; return before + " " + look(); }
console.log(inner());
