const log: string[] = [];
class Steps { constructor(public limit: number, public failsAt = -1) {} [Symbol.iterator]() { log.push("open"); let at = 0; const limit = this.limit, failsAt = this.failsAt; return { next() { log.push("next"); if (at === failsAt) throw new RangeError("of next"); return at < limit ? { done: false, value: at++ } : { done: true, value: undefined }; }, return() { log.push("return"); return {}; } }; } }
function flush(): string { const text = log.join(); log.length = 0; return text; } // @ts-expect-error
function total(items: Steps): number { let sum = 0; for (const item of items) sum += item; return sum; }
function first(items: Steps, wanted: number): number { for (const item of items) if (item >= wanted) return item; return -1; }
function risky(items: Steps, bad: number): string { try { for (const item of items) if (item === bad) throw new RangeError("of the turn"); return "end"; } catch (error) { return (error as Error).message; } }
function pairs(rows: Steps, columns: Steps): string { let text = ""; outer: for (const row of rows) for (const column of columns) { if (column > row) continue outer; if (row === 2) break outer; text += row + "" + column + ";"; } return text; }
let out = ""; for (let round = 0; round < 3; round++) out += [total(new Steps(3)), flush(), first(new Steps(5), 2), flush(), first(new Steps(1), 9), flush(), risky(new Steps(4), 1), flush(), risky(new Steps(4, 2), 9), flush(), pairs(new Steps(4), new Steps(3)), flush()].join(" ") + "\n"; console.log(out);
