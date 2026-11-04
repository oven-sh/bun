// every level of a recursion leaves for its slow version, down to where the stack ends: what comes is a RangeError that can be caught, and the program goes on
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Kind { flags: number; id: number; constructor(flags: number) { this.flags = flags; this.id = flags + 1; } }
function down(type: Kind, n: number): number {
  const i = (n + 1) | 0, d = n * 0.5;
  const a = type.flags;
  return downByValue(type, i) + (a as any === "f" ? 1 : 0) + (d > -1 ? 0 : 1);
}
const downByValue = through(down);
const other = { flags: "f" };
for (let round = 0; round < 3; round++) {
  let caught = "nothing";
  try { downByValue(other as any, 0); } catch (error) { caught = (error as Error).constructor.name; }
  console.log(caught);
}
function shallow(type: Kind, n: number): number { const i = (n + 1) | 0; const a = type.flags; return n > 50 ? i : shallowByValue(type, i) + (a as any === "f" ? 1 : 0); }
const shallowByValue = through(shallow);
console.log(shallowByValue(other as any, 0), shallowByValue(new Kind(1), 0));
