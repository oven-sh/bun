const n = 140000;
function make(): number[] { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i); return list; }
function attempt(list: number[], does: (list: number[]) => unknown): string { try { does(list); return "done " + list.length + ":" + list[0] + ":" + list[1] + ":" + list[2]; } catch (error) { return (error as Error).constructor.name + " " + list.length + ":" + list[0] + ":" + list[1] + ":" + list[2]; } }
for (const close of [Object.freeze, Object.seal, Object.preventExtensions]) { console.log(attempt(close(make()) as number[], l => l.splice(1, 1)), attempt(close(make()) as number[], l => l.splice(1, 0, -1)), attempt(close(make()) as number[], l => l.splice(1, 1, -1)), attempt(close(make()) as number[], l => l.shift()), attempt(close(make()) as number[], l => l.unshift(-1))); }
const fixed = make(); Object.defineProperty(fixed, "length", { writable: false }); console.log(attempt(fixed, l => l.splice(1, 1)), attempt(fixed, l => l.splice(1, 0, -1)));
