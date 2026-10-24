declare const console: { log(...values: unknown[]): void };
function sum(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
function sumOf(a: number[]): number { let t = 0; for (const x of a) t += x; return t; }
function sumDown(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= 0; i--) t += a[i]; return t; }
function largest(a: number[]): number { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
function find(a: number[], v: number): number { for (let i = 0; i < a.length; i++) if (a[i] === v) return i; return -1; }
function absent(a: number[]): number { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] === undefined) n++; return n; }
function fill(a: number[], v: number): number { for (let i = 0; i < a.length; i++) a[i] = v; return a.length; }
function fillIndex(a: number[]): number { for (let i = 0; i < a.length; i++) a[i] = i; return a.length; }
function fillZero(a: number[]): number { for (let i = 0; i < a.length; i++) a[i] = 0; return a.length; }
function copy(a: number[], b: number[]): number { for (let i = 0; i < a.length; i++) b[i] = a[i]; return b.length; }
function scale(a: number[], k: number): number { for (let i = 0; i < a.length; i++) a[i] = a[i] * k; return a.length; }
function bump(a: number[]): number { for (let i = 0; i < a.length; i++) a[i]++; return a.length; }
function dot(a: number[], b: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += a[i] * b[i]; return t; }
function gather(a: number[], b: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += b[a[i]]; return t; }
function bits(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t ^= a[i]; return t; }
function append(a: number[], n: number, v: number): number { for (let i = 0; i < n; i++) a[a.length] = v + i; return a.length; }
function pushAll(a: number[], n: number, v: number): number { for (let i = 0; i < n; i++) a.push(v + i); return a.length; }
function one(a: number[], i: number): number { return a[i]; }
function put(a: number[], i: number, v: number): void { a[i] = v; }
function nested(a: number[], b: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) t += a[i] * b[j]; return t; }
function rows(m: number[][]): number { let t = 0; for (let i = 0; i < m.length; i++) { const row = m[i]; for (let j = 0; j < row.length; j++) t += row[j]; } return t; }

function storeSumStore(a: number[]): number { a[0] = 1; const s = sum(a); a[1] = 2; return s * 100 + a[0] * 10 + a[1]; }
function readSumRead(a: number[]): number { const x = a[0]; const s = sum(a); const y = a[0]; return s * 100 + x * 10 + y; }
function throughTwoViews(a: number[], u: unknown[]): string { u[0] = 7; const s = sum(a); u[1] = 8; u[2] = 9; return s + " " + a[0] + " " + a[1] + " " + a[2] + " " + String(u[1]); }
function pushSumPush(a: number[], u: unknown[]): string { u.push(4); const s = sumOf(a); u.push(5); return s + " " + a.length + " " + a[a.length - 1] + " " + a[a.length - 2]; }
function storeInLoopAroundSum(a: number[]): number { let t = 0; for (let k = 0; k < 3; k++) { a[k] = k + 1; t += sum(a); a[k + 1] = 1; } return t; }
function sumTwice(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; for (let i = 0; i < a.length; i++) t += a[i] * 2; return t; }
let never = 0;
function sumApart(a: number[]): number { try { if (never > 0) throw never; } catch { return -1; } let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
function sumOfApart(a: number[]): number { try { if (never > 0) throw never; } catch { return -1; } let t = 0; for (const x of a) t += x; return t; }
function throughAnother(a: number[]): number { try { if (never > 0) throw never; } catch { return -1; } return sumApart(a) + 1; }
function storeCallStore(a: number[]): number { a[0] = 1; const s = sumApart(a); a[1] = 2; return s * 100 + a[0] * 10 + a[1]; }
function storeCallStoreTwice(a: number[]): number { a[0] = 1; a[1] = 5; const s = sumOfApart(a); a[1] = 2; a[2] = 3; return s * 1000 + a[0] * 100 + a[1] * 10 + a[2]; }
function readCallRead(a: number[]): number { const x = a[0]; const s = sumApart(a); const y = a[0]; return s * 100 + x * 10 + y; }
function storeCallThroughAnother(a: number[]): number { a[0] = 4; const s = throughAnother(a); a[1] = 6; a[0] = 7; return s * 100 + a[0] * 10 + a[1]; }
function viewsAroundCall(a: number[], u: unknown[]): string { u[0] = 7; const s = sumApart(a); u[1] = 8; u[2] = 9; return s + " " + a[0] + " " + a[1] + " " + a[2] + " " + String(u[1]); }
function pushAroundCall(a: number[], u: unknown[]): string { u.push(4); const s = sumOfApart(a); u.push(5); return s + " " + a.length + " " + a[a.length - 1] + " " + a[a.length - 2]; }
function storesInLoopAroundCall(a: number[]): number { let t = 0; for (let k = 0; k < 3; k++) { a[k] = k + 1; t += sumApart(a); a[k + 1] = 1; } return t; }
function wholeStoresInLoopAroundCall(a: number[], n: number): number { let t = 0; for (let k = 0; k < n; k++) { a[0] = k | 0; if (k === 1) t += sumApart(a); a[1] = (k + 1) | 0; } return t + a[0] + a[1]; }
function readCallStore(a: number[]): number { const x = a[0]; const s = sumApart(a); a[1] = 2; return s * 1000 + x * 100 + a[1] * 10 + a[0]; }
function readCallPush(a: number[]): number { const x = a[0]; const s = sumOfApart(a); a.push(3); return s * 1000 + x * 100 + a[a.length - 1] * 10 + a.length; }
function readCallFillZero(a: number[]): number { const x = a[0]; const s = sumApart(a); for (let i = 0; i < a.length; i++) a[i] = 0; return s * 100 + x * 10 + a[0]; }
function readCallStoreThroughAnother(a: number[]): number { const x = a[1]; const s = throughAnother(a); a[0] = 5; a[2] = 6; return s * 1000 + x * 100 + a[0] * 10 + a[2]; }
function rowsAroundCall(rows: number[][]): number { let t = 0; for (let k = 0; k < rows.length; k++) { const row = rows[k]; t += row[0]; t += sumApart(row); t += row[0] * 10 + row[1]; } return t; }
function rowsAroundCallThroughAnother(rows: number[][]): number { let t = 0; for (let k = 0; k < rows.length; k++) { const row = rows[k]; const x = row[1]; t += throughAnother(row); t += row[1] * 10 + x + row[2]; } return t; }
function rowsLargestAroundCall(rows: number[][]): number { let m = -1; for (let k = 0; k < rows.length; k++) { const row = rows[k]; if (row[0] > m) m = row[0]; m += sumOfApart(row); if (row[0] > m) m = row[0]; if (row[2] > 2) m += row[2]; } return m; }
function sumLong(a: number[]): number {
    let t = 0;
    for (let i = 0; i < a.length; i++) t += a[i];
    for (let i = 0; i < a.length; i++) t += a[i] * 2;
    for (let i = 0; i < a.length; i++) if (a[i] > 3) t += 1;
    for (let i = 0; i < a.length; i++) t += a[i] * a[i];
    for (let i = 0; i < a.length; i++) t -= a[i] * a[i];
    for (let i = 0; i < a.length; i++) if (a[i] > 3) t -= 1;
    for (let i = 0; i < a.length; i++) t -= a[i] * 2;
    for (let i = 1; i < a.length; i++) t += a[i] - a[i - 1];
    for (let i = 1; i < a.length; i++) t -= a[i] - a[i - 1];
    return t;
}
function rowsAroundLongCall(rows: number[][]): number { let t = 0; for (let k = 0; k < rows.length; k++) { const row = rows[k]; t += row[0]; t += sumLong(row); t += row[0] * 10 + row[1]; } return t; }
function rowsLargestAroundLongCall(rows: number[][]): number { let m = -1; for (let k = 0; k < rows.length; k++) { const row = rows[k]; if (row[0] > m) m = row[0]; m += sumLong(row); if (row[0] > m) m = row[0]; if (row[2] > 2) m += row[2]; } return m; }
function rowsTwiceAroundLongCall(rows: number[][]): number { let t = 0; for (let k = 0; k < rows.length; k++) { const row = rows[k]; const x = row[1] + row[2]; const s = sumLong(row); t += s + x + row[1] + row[2]; } return t; }
function rowsOfAnythingAroundLongCall(rows: number[][], seen: unknown[]): number { let t = 0; for (let k = 0; k < rows.length; k++) { const row = rows[k]; seen.push(row[0]); t += sumLong(row); seen.push(row[0]); seen.push(row[1]); } return t; }
function longCallAlone(a: number[]): number { return sumLong(a) + 1; }
function emptyLoop(a: number[], n: number): number { let t = 0; for (let i = 0; i < n; i++) t += a[i]; return t; }
function nilInFrontOfLoop(a: number[] | undefined, n: number): string { let t = 0; try { for (let i = 0; i < n; i++) t += a![i]; } catch (e) { return "caught " + (e instanceof TypeError) + " " + t; } return String(t); }
function chosenInLoop(a: number[], b: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) { const c = i & 1 ? a : b; t += c[i]; } return t; }
function sumThenStoreWhole(a: number[], k: number): number { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; a[0] = k | 0; a[1] = (k + 1) | 0; return t + a[0] + a[1]; }

function show(a: unknown[]): string {
    let s = "";
    for (let i = 0; i < a.length; i++) s += (i ? "," : "") + (i in a ? (Object.is(a[i], -0) ? "-0" : typeof a[i] + ":" + String(a[i])) : "hole");
    return "[" + s + "] " + JSON.stringify(a) + " " + a.length;
}
const makers: [string, () => number[]][] = [
    ["parsed", () => JSON.parse("[1,2,3,4,5,6,7,8]") as number[]],
    ["parsed, edges", () => JSON.parse("[2147483647,-2147483648,0,-1,1,2,3,4]") as number[]],
    ["parsed, one", () => JSON.parse("[5]") as number[]],
    ["parsed, none", () => JSON.parse("[]") as number[]],
    ["parsed, mixed", () => JSON.parse("[1,2.5,3,4]") as number[]],
    ["parsed, with a hole", () => { const a = JSON.parse("[1,2,3,4,5]") as number[]; delete (a as unknown[])[2]; return a; }],
    ["parsed, longer than it is filled", () => { const a = JSON.parse("[1,2,3]") as number[]; a.length = 6; return a; }],
    ["parsed, shortened", () => { const a = JSON.parse("[1,2,3,4,5,6]") as number[]; a.length = 2; return a; }],
    ["parsed, with a name", () => { const a = JSON.parse("[1,2,3,4]") as number[]; (a as unknown as { tag: string }).tag = "t"; return a; }],
    ["parsed, frozen", () => Object.freeze(JSON.parse("[1,2,3,4]")) as number[]],
    ["parsed, sealed", () => Object.seal(JSON.parse("[1,2,3,4]")) as number[]],
    ["parsed, not extensible", () => Object.preventExtensions(JSON.parse("[1,2,3,4]")) as number[]],
    ["Array.of", () => (Array.of as (...values: unknown[]) => unknown[])(1, 2, 3, 4) as number[]],
    ["cloned", () => structuredClone(JSON.parse("[3,2,1,0]")) as number[]],
    ["sliced", () => (JSON.parse("[9,8,7,6,5]") as unknown[]).slice(1) as number[]],
    ["values that are whole", () => { const a = JSON.parse("[1,2,3,\"x\"]") as unknown[]; a.pop(); return a as number[]; }],
    ["a literal of anything", () => ([1, 2, 3, 4, 5] as unknown[]) as number[]],
    ["a literal of anything, sliced", () => ([6, 5, 4, 3] as unknown[]).slice() as number[]],
    ["a literal of anything, twice", () => { const make = (): unknown[] => [7, 8, 9]; const first = make() as number[]; sum(first); first[0] = 0.5; return make() as number[]; }],
    ["Array.from", () => Array.from([4, 3, 2, 1] as unknown[]) as number[]],
    ["born here", () => [1, 2, 3, 4]],
    ["born here, pushed", () => { const a: number[] = []; for (let i = 0; i < 5; i++) a.push(i); return a; }],
];
function tell(name: string, f: () => unknown): void {
    let said: string;
    try { const v = f(); said = Object.is(v, -0) ? "-0" : String(v); } catch (e) { said = e instanceof TypeError ? "TypeError" : "threw " + String(e); }
    console.log("  " + name + ": " + said);
}
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of makers) {
        console.log(name + ", turn " + turn);
        tell("sum", () => { const a = make(); return sum(a) + " " + show(a); });
        tell("sumOf", () => { const a = make(); return sumOf(a) + " " + show(a); });
        tell("sumDown", () => { const a = make(); return sumDown(a) + " " + show(a); });
        tell("largest", () => { const a = make(); return largest(a) + " " + show(a); });
        tell("find", () => { const a = make(); return find(a, 3) + " " + find(a, 2.5) + " " + find(a, -7) + " " + show(a); });
        tell("absent", () => { const a = make(); return absent(a) + " " + show(a); });
        tell("fill whole", () => { const a = make(); return fill(a, 7) + " " + show(a); });
        tell("fill half", () => { const a = make(); return fill(a, 0.5) + " " + show(a); });
        tell("fill NaN", () => { const a = make(); return fill(a, NaN) + " " + show(a); });
        tell("fill -0", () => { const a = make(); return fill(a, -0) + " " + show(a); });
        tell("fillIndex", () => { const a = make(); return fillIndex(a) + " " + show(a); });
        tell("fillZero", () => { const a = make(); return fillZero(a) + " " + show(a); });
        tell("copy", () => { const a = make(), b = make(); fill(b, 0); return copy(a, b) + " " + show(a) + " " + show(b); });
        tell("copy onto itself", () => { const a = make(); return copy(a, a) + " " + show(a); });
        tell("copy into doubles", () => { const a = make(), b = [0.5, 0.5]; return copy(a, b) + " " + show(b); });
        tell("copy from doubles", () => { const a = [0.5, 1.5], b = make(); return copy(a, b) + " " + show(b); });
        tell("scale", () => { const a = make(); return scale(a, 2) + " " + show(a); });
        tell("scale by a half", () => { const a = make(); return scale(a, 0.5) + " " + show(a); });
        tell("bump", () => { const a = make(); return bump(a) + " " + show(a); });
        tell("dot", () => { const a = make(), b = make(); return dot(a, b) + " " + dot(a, a) + " " + show(a); });
        tell("gather", () => { const a = JSON.parse("[0,1,0,1]") as number[], b = make(); return gather(a, b) + " " + show(a) + " " + show(b); });
        tell("bits", () => { const a = make(); return bits(a) + " " + show(a); });
        tell("append", () => { const a = make(); return append(a, 20, 1) + " " + show(a); });
        tell("append halves", () => { const a = make(); return append(a, 3, 0.5) + " " + show(a); });
        tell("pushAll", () => { const a = make(); return pushAll(a, 20, 1) + " " + show(a); });
        tell("pushAll halves", () => { const a = make(); return pushAll(a, 3, 0.5) + " " + show(a); });
        tell("one", () => { const a = make(); return one(a, 0) + " " + one(a, 1) + " " + one(a, 99) + " " + one(a, -1) + " " + show(a); });
        tell("put", () => { const a = make(); put(a, 0, 11); put(a, 1, 1.5); put(a, 9, 3); return show(a); });
        tell("nested", () => { const a = make(), b = make(); return nested(a, b) + " " + nested(a, a) + " " + show(a); });
        tell("rows", () => { const m = [make(), make(), [0.5], make()]; return rows(m) + " " + show(m[0]) + " " + show(m[3]); });
        tell("storeSumStore", () => { const a = make(); return storeSumStore(a) + " " + show(a); });
        tell("readSumRead", () => { const a = make(); return readSumRead(a) + " " + show(a); });
        tell("throughTwoViews", () => { const a = make(); return throughTwoViews(a, a) + " " + show(a); });
        tell("pushSumPush", () => { const a = make(); return pushSumPush(a, a) + " " + show(a); });
        tell("storeInLoopAroundSum", () => { const a = make(); return storeInLoopAroundSum(a) + " " + show(a); });
        tell("sumTwice", () => { const a = make(); return sumTwice(a) + " " + show(a); });
        tell("sumThenStoreWhole", () => { const a = make(); return sumThenStoreWhole(a, 40) + " " + show(a); });
        tell("storeCallStore", () => { const a = make(); return storeCallStore(a) + " " + show(a); });
        tell("storeCallStoreTwice", () => { const a = make(); return storeCallStoreTwice(a) + " " + show(a); });
        tell("readCallRead", () => { const a = make(); return readCallRead(a) + " " + show(a); });
        tell("storeCallThroughAnother", () => { const a = make(); return storeCallThroughAnother(a) + " " + show(a); });
        tell("viewsAroundCall", () => { const a = make(); return viewsAroundCall(a, a) + " " + show(a); });
        tell("pushAroundCall", () => { const a = make(); return pushAroundCall(a, a) + " " + show(a); });
        tell("storesInLoopAroundCall", () => { const a = make(); return storesInLoopAroundCall(a) + " " + show(a); });
        tell("wholeStoresInLoopAroundCall", () => { const a = make(); return wholeStoresInLoopAroundCall(a, 4) + " " + show(a); });
        tell("readCallStore", () => { const a = make(); return readCallStore(a) + " " + show(a); });
        tell("readCallPush", () => { const a = make(); return readCallPush(a) + " " + show(a); });
        tell("readCallFillZero", () => { const a = make(); return readCallFillZero(a) + " " + show(a); });
        tell("readCallStoreThroughAnother", () => { const a = make(); return readCallStoreThroughAnother(a) + " " + show(a); });
        tell("rowsAroundCall", () => { const rows = [make(), make(), make()]; return rowsAroundCall(rows) + " " + show(rows[0]) + show(rows[2]); });
        tell("rowsAroundCallThroughAnother", () => { const rows = [make(), make()]; return rowsAroundCallThroughAnother(rows) + " " + show(rows[1]); });
        tell("rowsLargestAroundCall", () => { const rows = [make(), make()]; return rowsLargestAroundCall(rows) + " " + show(rows[0]); });
        tell("rowsAroundLongCall", () => { const rows = [make(), make(), make()]; return rowsAroundLongCall(rows) + " " + show(rows[0]) + show(rows[2]); });
        tell("rowsLargestAroundLongCall", () => { const rows = [make(), make()]; return rowsLargestAroundLongCall(rows) + " " + show(rows[0]); });
        tell("rowsTwiceAroundLongCall", () => { const rows = [make(), make()]; return rowsTwiceAroundLongCall(rows) + " " + show(rows[1]); });
        tell("rowsOfAnythingAroundLongCall", () => { const rows = [make(), make()]; const seen: unknown[] = []; return rowsOfAnythingAroundLongCall(rows, seen) + " " + show(seen) + show(rows[1]); });
        tell("longCallAlone", () => { const a = make(); return longCallAlone(a) + " " + show(a); });
        tell("emptyLoop", () => { const a = make(); return emptyLoop(a, 0) + " " + emptyLoop(a, 2) + " " + show(a); });
        tell("nilInFrontOfLoop", () => { const a = make(); return nilInFrontOfLoop(undefined, 0) + " " + nilInFrontOfLoop(undefined, 2) + " " + nilInFrontOfLoop(a, 2) + " " + show(a); });
        tell("chosenInLoop", () => { const a = make(), b = make(); return chosenInLoop(a, b) + " " + show(a) + " " + show(b); });
        tell("methods afterwards", () => { const a = make(); sum(a); return a.indexOf(3) + " " + a.includes(2) + " " + a.lastIndexOf(1) + " " + a.join("-") + " " + a.slice(1, 3).join() + " " + a.concat([1.5]).join() + " " + [...a].reverse().join() + " " + a.map(x => x + 1).join() + " " + a.filter(x => x > 1).length + " " + a.reduce((t, x) => t + x, 0) + " " + Math.max(...a) + " " + [...a].sort((x, y) => y - x).join() + " " + Object.keys(a).join() + " " + Array.isArray(a); });
        tell("a text stored afterwards", () => { const a = make(); sum(a); (a as unknown[])[1] = "x"; return show(a); });
        tell("undefined stored afterwards", () => { const a = make(); sum(a); (a as unknown[])[1] = undefined; return show(a) + " " + absent(a); });
    }
}
