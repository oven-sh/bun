interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function mix(first: Point, text: string, second: Point, run: () => number): string { const parts: unknown[] = []; parts.push(first === null, text === undefined, second == null, typeof run); if (first) parts.push(first.x); if (text) parts.push(text.length); if (second) parts.push(second.y); if (run) parts.push(run()); return parts.join(); }
const values: [Point, string, Point, () => number] = [origin, "ab", { x: 3, y: 4 }, () => 9];
for (let mask = 0; mask < 16; mask++) { const given = values.map((value, index) => (mask >> index) & 1 ? (index % 2 ? undefined : null) : value) as typeof values; attempt("mix " + mask, () => mix(...given)); }
