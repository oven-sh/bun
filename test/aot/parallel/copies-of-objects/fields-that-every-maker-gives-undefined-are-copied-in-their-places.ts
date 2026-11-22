type Wide = { a: number; b?: string; c?: string; d?: string; e?: string; f?: string; g?: string; h?: string; i?: string; j?: string; k?: string; l?: string; m: number };
function make(n: number): Wide { return { a: n, b: undefined, c: undefined, d: undefined, e: undefined, f: undefined, g: undefined, h: undefined, i: undefined, j: undefined, k: undefined, l: undefined, m: n + 1 }; }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o); }
function alone(s: Wide) { return { ...s }; }
function behind(s: Wide, z: number) { return { ...s, z }; }
function assigned(s: Wide, z: number) { return Object.assign({ z }, s); }
const kept = [make(1), make(2)];
kept[1]!.f = "filled";
(globalThis as any).kept = kept;
for (let z = 0; z < 3; z++) for (const s of kept) console.log(show(alone(s)), "|", show(behind(s, z)), "|", show(assigned(s, z)));
