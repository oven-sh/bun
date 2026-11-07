// answers: with-library
// # The body that runs where a parameter is not what its type says is written straight: every value has a word of the frame, and a word is given back
// # at the value's last read. But the frame was sized in front of that by ALL the values of a block that are read once in it, not by the most that are
// # alive at once: a literal of two dozen sums took 528 bytes a call where 192 do, and a recursion that `bun <file>` runs overflowed at half its depth.
// # The objects come from JSON.parse, so they have no layout of the compiler's and the guard of `shift` sends every call to that body.
// # f1 = shift
// # RUN(FRAME): bytes f1:SlowBody mechanisms=all
// # REQUIRES(FRAME): x86_64 as-written
// # FRAME: frame=192@
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
interface Node { kind: string; text: string; start: number; end: number; line: number; column: number; endLine: number; endColumn: number; flags: number; modifiers: number; symbol: number; scope: number; type: number; parent: number; order: number; depth: number; cost: number; width: number; height: number; left: number; right: number; first: number; last: number; index: number; body: Node | null }
function parse(at: number): Node { return JSON.parse('{"kind":"k","text":"t",' + "start,end,line,column,endLine,endColumn,flags,modifiers,symbol,scope,type,parent,order,depth,cost,width,height,left,right,first,last,index".split(",").map((x, i) => '"' + x + '":' + (at + i)).join() + "}"); }
function shift(t: Node, by: number): Node { return { kind: t.kind, text: t.text, start: t.start + by, end: t.end + by, line: t.line + by, column: t.column + by, endLine: t.endLine + by, endColumn: t.endColumn + by, flags: t.flags + by, modifiers: t.modifiers + by, symbol: t.symbol + by, scope: t.scope + by, type: t.type + by, parent: t.parent + by, order: t.order + by, depth: t.depth + by, cost: t.cost + by, width: t.width + by, height: t.height + by, left: t.left + by, right: t.right + by, first: t.first + by, last: t.last + by, index: t.index + by, body: t.body && shift(t.body, by) }; }
const deep: number = JSON.parse("300");
let tree: Node | null = null;
for (let i = 0; i < deep; i++) { const o = parse(i & 7); o.body = tree; tree = o; }
const moved: Node | null = tree && shift(tree, 3);
let levels = 0;
let sum = 0;
for (let at = moved; at; at = at.body) { levels++; sum += at.start + at.end * 2 + at.flags * 3 + at.index * 5 + at.last * 7 + at.kind.length + at.text.length; }
report(levels);
report(sum);
report(moved ? Object.keys(moved).join() : "");
report("end");
