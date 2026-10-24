interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
const list: Point[] = [origin, { x: 3, y: 4 }, { x: 5, y: 6 }];
function sumUntilNone(points: Point[]): number { let sum = 0, index = 0, point: Point; while ((point = points[index++])) sum += point.x; return sum; }
function lastBeforeNone(points: Point[]): number { let index = 0; let last: Point = points[0]; for (let next: Point = points[0]; next !== undefined; next = points[++index]) last = next; return last.y; }
const texts: string[] = ["a", "bc", "def"];
function lengths(all: string[]): number { let sum = 0, index = 0, text: string; while ((text = all[index++]) !== undefined) sum += text.length; return sum; }
console.log(sumUntilNone(list), lastBeforeNone(list), lengths(texts), sumUntilNone([]), lengths([]));
