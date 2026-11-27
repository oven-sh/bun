// STATISTIC: ElementMoveLoops >= 6
// A row of a table is the table itself, or stands in it twice: what a store puts into the row is read again in the same turn. A copy of the loop for rows of int32s reads the row once.
"use strict";
function show(v, d) { return Array.isArray(v) ? d > 2 ? ".." : "[" + v.map(x => show(x, d + 1)).join() + "]" : typeof v === "object" && v !== null ? "o" + v.id : String(v); }
const things = Array.from({ length: 8 }, (_, id) => ({ id }));
function rowsTexts(n) { const m = []; for (let i = 0; i < n; i++) { const r = []; for (let j = 0; j < n; j++) r.push("t" + i + j); m.push(r); } return m; }
function swappedTexts(m) { const a = 4; for (let i = 0; i < m.length; i++) { const t = m[i][a]; m[i][a] = m[i][a + 1]; m[i][a + 1] = t; } return m; }
function movedTexts(m) { const a = 2; for (let i = 0; i < m.length; i++) { m[i][a] = m[i][a + 2]; m[i][a + 2] = m[i][0]; } return m; }
function betweenTexts(m) { for (let i = 0; i < m.length; i++) { const t = m[i][1]; m[i][1] = m[i][3]; m[i][3] = m[i][5]; m[i][5] = t; } return m; }
function mirroredTexts(m) { for (let i = 0; i < m.length; i++) { const t = m[i][0]; m[i][0] = m[i][m.length - 1]; m[i][m.length - 1] = t; } return m; }
function rowsInts(n) { const m = []; for (let i = 0; i < n; i++) { const r = []; for (let j = 0; j < n; j++) r.push(i * 10 + j); m.push(r); } return m; }
function swappedInts(m) { const a = 4; for (let i = 0; i < m.length; i++) { const t = m[i][a]; m[i][a] = m[i][a + 1]; m[i][a + 1] = t; } return m; }
function movedInts(m) { const a = 2; for (let i = 0; i < m.length; i++) { m[i][a] = m[i][a + 2]; m[i][a + 2] = m[i][0]; } return m; }
function betweenInts(m) { for (let i = 0; i < m.length; i++) { const t = m[i][1]; m[i][1] = m[i][3]; m[i][3] = m[i][5]; m[i][5] = t; } return m; }
function mirroredInts(m) { for (let i = 0; i < m.length; i++) { const t = m[i][0]; m[i][0] = m[i][m.length - 1]; m[i][m.length - 1] = t; } return m; }
function rowsDoubles(n) { const m = []; for (let i = 0; i < n; i++) { const r = []; for (let j = 0; j < n; j++) r.push(i * 10 + j + 0.5); m.push(r); } return m; }
function swappedDoubles(m) { const a = 4; for (let i = 0; i < m.length; i++) { const t = m[i][a]; m[i][a] = m[i][a + 1]; m[i][a + 1] = t; } return m; }
function movedDoubles(m) { const a = 2; for (let i = 0; i < m.length; i++) { m[i][a] = m[i][a + 2]; m[i][a + 2] = m[i][0]; } return m; }
function betweenDoubles(m) { for (let i = 0; i < m.length; i++) { const t = m[i][1]; m[i][1] = m[i][3]; m[i][3] = m[i][5]; m[i][5] = t; } return m; }
function mirroredDoubles(m) { for (let i = 0; i < m.length; i++) { const t = m[i][0]; m[i][0] = m[i][m.length - 1]; m[i][m.length - 1] = t; } return m; }
function rowsObjects(n) { const m = []; for (let i = 0; i < n; i++) { const r = []; for (let j = 0; j < n; j++) r.push(things[(i + j) & 7]); m.push(r); } return m; }
function swappedObjects(m) { const a = 4; for (let i = 0; i < m.length; i++) { const t = m[i][a]; m[i][a] = m[i][a + 1]; m[i][a + 1] = t; } return m; }
function movedObjects(m) { const a = 2; for (let i = 0; i < m.length; i++) { m[i][a] = m[i][a + 2]; m[i][a + 2] = m[i][0]; } return m; }
function betweenObjects(m) { for (let i = 0; i < m.length; i++) { const t = m[i][1]; m[i][1] = m[i][3]; m[i][3] = m[i][5]; m[i][5] = t; } return m; }
function mirroredObjects(m) { for (let i = 0; i < m.length; i++) { const t = m[i][0]; m[i][0] = m[i][m.length - 1]; m[i][m.length - 1] = t; } return m; }
const shapes = { usual: m => m, itself: m => { m[4] = m; return m; }, first: m => { m[0] = m; return m; }, last: m => { m[5] = m; return m; }, twice: m => { m[3] = m[1]; return m; }, second: m => { m[1] = m; return m; }, others: m => { m[2] = [1, 2, 3, 4, 5, 6]; m[5] = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]; return m; }, short: m => { m[2] = [1]; return m; } };
for (let round = 0; round < 3; round++) {
    for (const [shape, shaped] of Object.entries(shapes)) {
        { const m = rowsTexts(6); shaped(m); console.log(shape, "swappedTexts", show(swappedTexts(m), 0)); }
        { const m = rowsTexts(6); shaped(m); console.log(shape, "movedTexts", show(movedTexts(m), 0)); }
        { const m = rowsTexts(6); shaped(m); console.log(shape, "betweenTexts", show(betweenTexts(m), 0)); }
        { const m = rowsTexts(6); shaped(m); console.log(shape, "mirroredTexts", show(mirroredTexts(m), 0)); }
        { const m = rowsInts(6); shaped(m); console.log(shape, "swappedInts", show(swappedInts(m), 0)); }
        { const m = rowsInts(6); shaped(m); console.log(shape, "movedInts", show(movedInts(m), 0)); }
        { const m = rowsInts(6); shaped(m); console.log(shape, "betweenInts", show(betweenInts(m), 0)); }
        { const m = rowsInts(6); shaped(m); console.log(shape, "mirroredInts", show(mirroredInts(m), 0)); }
        { const m = rowsDoubles(6); shaped(m); console.log(shape, "swappedDoubles", show(swappedDoubles(m), 0)); }
        { const m = rowsDoubles(6); shaped(m); console.log(shape, "movedDoubles", show(movedDoubles(m), 0)); }
        { const m = rowsDoubles(6); shaped(m); console.log(shape, "betweenDoubles", show(betweenDoubles(m), 0)); }
        { const m = rowsDoubles(6); shaped(m); console.log(shape, "mirroredDoubles", show(mirroredDoubles(m), 0)); }
        { const m = rowsObjects(6); shaped(m); console.log(shape, "swappedObjects", show(swappedObjects(m), 0)); }
        { const m = rowsObjects(6); shaped(m); console.log(shape, "movedObjects", show(movedObjects(m), 0)); }
        { const m = rowsObjects(6); shaped(m); console.log(shape, "betweenObjects", show(betweenObjects(m), 0)); }
        { const m = rowsObjects(6); shaped(m); console.log(shape, "mirroredObjects", show(mirroredObjects(m), 0)); }
    }
}
