// the loop of the growing text has no turn, or one: what comes out is what went in, or that with one part behind it
function grow(first: string, part: string, n: number) { let s = first; for (let i = 0; i < n; i++) s += part; return s; }
function growFromNothing(part: string, n: number) { let s = ""; for (let i = 0; i < n; i++) s += part; return s; }
function growOverList(parts: string[]) { let s = ""; for (let i = 0; i < parts.length; i++) s += parts[i]; return s; }
const long = "a long text ".repeat(400);
console.log(JSON.stringify(grow("", "x", 0)), grow("first", "x", 0), grow("first", "x", 1), grow("", "x", 1));
console.log(grow(long, "x", 0) === long, grow(long, "x", 0).length, grow(long, "x", 1).length, grow(long, "", 3) === long);
console.log(JSON.stringify(growFromNothing("x", 0)), growFromNothing("x", 1), growFromNothing(long, 1) === long, growFromNothing(long, 2).length);
console.log(JSON.stringify(growOverList([])), growOverList(["one"]), growOverList(["", "", "two", ""]), growOverList([long]) === long, growOverList(["Ā"]), growOverList(["a", "Ā"]));
