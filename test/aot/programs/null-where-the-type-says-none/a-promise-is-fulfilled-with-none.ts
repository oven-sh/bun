interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
async function give(what: number): Promise<Point> { return (what === 0 ? origin : what === 1 ? null : undefined) as any; }
async function use(what: number): Promise<string> { const point: Point = await give(what); try { return "x " + point.x; } catch (error) { return (error as Error).constructor.name + " " + (point === null) + " " + (point === undefined); } }
for (const what of [0, 1, 2, 0]) console.log(await use(what));
console.log((await Promise.all([give(0), give(1), give(2)])).map(point => point === null ? "null" : point === undefined ? "undefined" : point.x).join());
