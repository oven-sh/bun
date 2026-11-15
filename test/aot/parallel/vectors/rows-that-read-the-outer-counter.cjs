const B = new DataView(new ArrayBuffer(8));
function show(v) { let t = 17, h = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; if (!(i in v)) { h++; continue; } if (typeof x !== "number" || x !== x) { t = (Math.imul(t, 31) + String(x).length) | 0; continue; } B.setFloat64(0, x); t = (Math.imul(t, 31) + B.getInt32(0)) | 0; t = (Math.imul(t, 31) + B.getInt32(4)) | 0; } return v.length + ":" + h + ":" + t; }

function make() { var width, height, rowSize; function set(w, h, s) { width = w; height = h; rowSize = s; }
function solve(x, x0, a, c) {
  var invC = 1 / c;
  for (var k = 0; k < 1; k++) {
    for (var j = 1; j <= height; j++) {
      var lastRow = (j - 1) * rowSize;
      var currentRow = j * rowSize;
      var nextRow = (j + 1) * rowSize;
      var lastX = x[currentRow];
      ++currentRow;
      for (var i = 1; i <= width; i++)
        lastX = x[currentRow] = ((x0[currentRow] + a*(lastX-x[++currentRow]+x[++lastRow]-x[++nextRow])) * invC) + j;
    }
    x[0] = 0.5 * (x[1] + x[rowSize]);
  }
}
return { set, solve }; }
const nest = make();
function run(x, x0, a, c, w, h, s) { nest.set(w, h, s); nest.solve(x, x0, a, c); }
function fill(n, how) { var l = new Array(n); for (var i = 0; i < n; i++) l[i] = how === 0 ? i * 0.37 - 4 : how === 1 ? Math.sin(i) : how === 2 ? 0.5 : how === 3 ? i : how === 4 ? (i & 3 ? i : i * 0.5) : how === 5 ? (i & 1 ? -0 : 1e-310) : 2 ** 53 + i; return l; }
{ const x = fill(646, 4); const x0 = x.slice();  try { run(x, x0, -0.5, 0.5, 159, 2, 79); run(x, x0, 0.25, 4, 159, 2, 79); } catch (e) { console.log(e.message); } console.log(0, show(x), show(x0)); }
{ const x = fill(156, 1); const x0 = x.slice(); x0[23] = NaN; try { run(x, x0, 3, 1, 9, 5, 18); run(x, x0, 0.25, 4, 9, 5, 18); } catch (e) { console.log(e.message); } console.log(1, show(x), show(x0)); }
{ const x = fill(87, 6); const x0 = x.slice(); x[22] = 1e308; x0[28] = -1e308; try { run(x, x0, 1, 1, 33, 1, 3); run(x, x0, 0.25, 4, 33, 1, 3); } catch (e) { console.log(e.message); } console.log(2, show(x), show(x0)); }
{ const x = fill(356, 1); const x0 = fill(356, 2); x[86] = 1e308; x0[129] = -1e308; try { run(x, x0, 0.25, 1, 170, 2, 1); run(x, x0, 0.25, 4, 170, 2, 1); } catch (e) { console.log(e.message); } console.log(3, show(x), show(x0)); }
{ const x = fill(1932, 5); const x0 = fill(1932, 1); x0[352] = NaN; try { run(x, x0, 0.2, 0.5, 160, 3, 320); run(x, x0, 0.25, 4, 160, 3, 320); } catch (e) { console.log(e.message); } console.log(4, show(x), show(x0)); }
{ const x = fill(908, 5); const x0 = fill(908, 1); x0[476] = Infinity; try { run(x, x0, 0.25, 1, 128, 3, 128); run(x, x0, 0.25, 4, 128, 3, 128); } catch (e) { console.log(e.message); } console.log(5, show(x), show(x0)); }
{ const x = fill(536, 4); const x0 = fill(536, 2);  try { run(x, x0, 0.25, 1, 64, 4, 66); run(x, x0, 0.25, 4, 64, 4, 66); } catch (e) { console.log(e.message); } console.log(6, show(x), show(x0)); }
{ const x = fill(118, 6); const x0 = fill(118, 1); x.length = x.length >> 1; try { run(x, x0, 3, 3, 8, 7, 10); run(x, x0, 0.25, 4, 8, 7, 10); } catch (e) { console.log(e.message); } console.log(7, show(x), show(x0)); }
{ const x = fill(37, 6); const x0 = fill(37, 5); x[2] = NaN; try { run(x, x0, 1, 4, 9, 5, 1); run(x, x0, 0.25, 4, 9, 5, 1); } catch (e) { console.log(e.message); } console.log(8, show(x), show(x0)); }
{ const x = fill(460, 0); const x0 = fill(460, 0);  try { run(x, x0, 0.2, 3, 64, 8, 32); run(x, x0, 0.25, 4, 64, 8, 32); } catch (e) { console.log(e.message); } console.log(9, show(x), show(x0)); }
{ const x = fill(58, 5); const x0 = fill(58, 2); x0[12] = NaN; try { run(x, x0, 0.2, 4, 16, 5, 2); run(x, x0, 0.25, 4, 16, 5, 2); } catch (e) { console.log(e.message); } console.log(10, show(x), show(x0)); }
{ const x = fill(704, 5); const x0 = x.slice(); x0[204] = Infinity; try { run(x, x0, 3, 0.5, 170, 2, 88); run(x, x0, 0.25, 4, 170, 2, 88); } catch (e) { console.log(e.message); } console.log(11, show(x), show(x0)); }
{ const x = fill(65, 6); const x0 = x.slice(); x[17] = NaN; try { run(x, x0, -0.5, 1, 9, 3, 7); run(x, x0, 0.25, 4, 9, 3, 7); } catch (e) { console.log(e.message); } console.log(12, show(x), show(x0)); }
{ const x = fill(452, 0); const x0 = fill(452, 0);  try { run(x, x0, 3, 3, 33, 9, 34); run(x, x0, 0.25, 4, 33, 9, 34); } catch (e) { console.log(e.message); } console.log(13, show(x), show(x0)); }
{ const x = fill(170, 1); const x0 = x; x[79] = NaN; try { run(x, x0, 0.25, 3, 16, 5, 18); run(x, x0, 0.25, 4, 16, 5, 18); } catch (e) { console.log(e.message); } console.log(14, show(x), show(x0)); }
{ const x = fill(1698, 3); const x0 = x.slice(); x0.length = x0.length >> 1; try { run(x, x0, 0.2, 0.5, 128, 9, 130); run(x, x0, 0.25, 4, 128, 9, 130); } catch (e) { console.log(e.message); } console.log(15, show(x), show(x0)); }
{ const x = fill(138, 1); const x0 = x; x0[43] = Infinity; try { run(x, x0, 1, 3, 8, 9, 10); run(x, x0, 0.25, 4, 8, 9, 10); } catch (e) { console.log(e.message); } console.log(16, show(x), show(x0)); }
{ const x = fill(56, 6); const x0 = x.slice(); x[7] = -Infinity; x0[4] = Infinity; try { run(x, x0, -0.5, 0.5, 1, 12, 3); run(x, x0, 0.25, 4, 1, 12, 3); } catch (e) { console.log(e.message); } console.log(17, show(x), show(x0)); }
{ const x = fill(124, 6); const x0 = fill(124, 0);  try { run(x, x0, 0.25, 0.5, 16, 3, 16); run(x, x0, 0.25, 4, 16, 3, 16); } catch (e) { console.log(e.message); } console.log(18, show(x), show(x0)); }
{ const x = fill(387, 0); const x0 = fill(387, 1); x[51] = -Infinity; x0[36] = Infinity; try { run(x, x0, 1, 4, 170, 5, 5); run(x, x0, 0.25, 4, 170, 5, 5); } catch (e) { console.log(e.message); } console.log(19, show(x), show(x0)); }
{ const x = fill(342, 1); const x0 = fill(342, 0); x[36] = 1e308; x0[72] = -1e308; try { run(x, x0, 1, 1, 159, 2, 3); run(x, x0, 0.25, 4, 159, 2, 3); } catch (e) { console.log(e.message); } console.log(20, show(x), show(x0)); }
{ const x = fill(2244, 4); const x0 = fill(2244, 0); x.length = x.length >> 1; try { run(x, x0, -0.5, 1, 170, 9, 172); run(x, x0, 0.25, 4, 170, 9, 172); } catch (e) { console.log(e.message); } console.log(21, show(x), show(x0)); }
{ const x = fill(59, 0); const x0 = x; x[19] = NaN; try { run(x, x0, 3, 3, 7, 9, 3); run(x, x0, 0.25, 4, 7, 9, 3); } catch (e) { console.log(e.message); } console.log(22, show(x), show(x0)); }
{ const x = fill(14, 1); const x0 = x; x0[1] = NaN; try { run(x, x0, 1, 0.5, 1, 9, 0); run(x, x0, 0.25, 4, 1, 9, 0); } catch (e) { console.log(e.message); } console.log(23, show(x), show(x0)); }
