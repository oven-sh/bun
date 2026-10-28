// Neighboring declarations that read members of one name, with types: Bun's transpiler prints them as one pattern, and each line has the words and the place of what is thrown there.
const frames = (error: any) => error.stack.split("\n").slice(1, 2).map((line: string) => line.replace(/^.*?([a-zA-Z<>.]+) \(.*:(\d+:\d+)\)$/, "$1@$2")).join(" ");
interface Point { x: number; y: number }
function typed(o: Point) { const x = o.x; const y = o.y; return [x, y]; }
function annotated(o: Point) { const x: number = o.x; const y: number = o.y; return [x, y]; }
function asserted(o: any) { const x = (o as Point).x; const y = (o as Point).y; return [x, y]; }
function nonNull(o: Point | null) { const x = o!.x; const y = o!.y; return [x, y]; }
for (const f of [typed, annotated, asserted, nonNull]) {
  for (const o of [null, undefined, { x: 1, y: 2 }]) {
    try { console.log(f.name, JSON.stringify(f(o as any))); } catch (error: any) { console.log(f.name, error.name, error.message.replace(/ \(evaluating .*\)$/, ""), frames(error)); }
  }
}
