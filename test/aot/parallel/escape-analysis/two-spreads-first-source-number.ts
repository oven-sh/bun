// Flags: --aot-validate --aot-heat=EverythingIsCold
// Two spreads into one literal. The first source has no own y, which the second spread always fills.
interface Point { x: number; y: number }
const other = { y: 20, w: 30 };
function merge(o: Point) { return { ...o, ...other }; }
const table: Record<string, any> = { merge, same: (o: any) => o };
const call = (o: any) => table[process.argv.length > 99 ? "same" : "merge"](o);
for (let i = 0; i < 3; i++) console.log(JSON.stringify(call({ x: i, y: 2 })));
console.log(JSON.stringify(call(5)));
console.log(JSON.stringify(call({ x: 9, y: 2 })));
