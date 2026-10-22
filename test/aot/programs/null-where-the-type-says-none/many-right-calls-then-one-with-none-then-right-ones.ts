interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
function weigh(point: Point, text: string): number { return point.x * 2 + point.y + text.length; }
let total = 0; const thrown: string[] = [];
for (let index = 0; index < 3000; index++) { const odd = index === 1500 || index === 2999; try { total += weigh(odd ? (null as any) : { x: index, y: 1 }, index === 2000 ? (undefined as any) : "ab"); } catch (error) { thrown.push(index + (error as Error).constructor.name); } }
console.log(total, thrown.join());
