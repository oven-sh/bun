interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function reader(point: Point): () => string { return () => point === null ? "null" : point === undefined ? "undefined" : "x " + point.x; }
function thrower(point: Point): () => number { return () => point.x; }
const readers = ([origin, null, undefined, { x: 4, y: 5 }] as Point[]).map(point => [reader(point), thrower(point)] as const);
for (const [read, fail] of readers) { attempt("read", read); attempt("fail", fail); }
