function giveOrCall(f: () => unknown, call: boolean): unknown { if (call) return f(); return f; }
function make(k: number, call: boolean): unknown { return giveOrCall(() => k, call); }
function double(k: string, call: boolean): unknown { return giveOrCall(() => k + k, call); }
const kept = [make(1, false), make(1, false), make(2, true), make(3, false), double("a", true), double("b", false)];
console.log(kept[0] === kept[0], kept[0] === kept[1], new Set(kept).size, kept[2], (kept[3] as () => number)(), kept[4], (kept[5] as () => string)(), typeof kept[1]);
