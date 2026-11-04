// the part and the text that enters are written as `string` and are something else: a number, undefined, null, an object that converts, a String object
let log = "";
function grow(first: string, part: string, n: number) { let s = first; for (let i = 0; i < n; i++) s += part; return s; }
function growTyped(part: number, n: number) { let s = ""; for (let i = 0; i < n; i++) s += part; return s; }
const converts = { toString() { log += "s"; return "S"; }, valueOf() { log += "v"; return 5; } };
console.log(grow("a", "b", 3), grow("", "", 3) === "");
console.log(grow("a", 1 as any, 2), grow("a", undefined as any, 2), grow("a", null as any, 2), grow("a", new String("w") as any, 2));
console.log(grow("a", converts as any, 2), log);
console.log(grow(1 as any, 2 as any, 3), typeof grow(1 as any, 2 as any, 3), grow(1 as any, "b", 2), grow(undefined as any, "b", 1), grow(null as any, 1 as any, 2));
console.log(grow(converts as any, "b", 2), log, grow(converts as any, "b", 0) === converts as any);
console.log(growTyped(1.5, 2), growTyped("t" as any, 2), growTyped(undefined as any, 2), growTyped(converts as any, 2), log);
console.log(grow("again", "b", 3));
