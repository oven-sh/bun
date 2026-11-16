const B = new DataView(new ArrayBuffer(8));
function show(v) { let t = 17, h = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; if (!(i in v)) { h++; continue; } if (typeof x !== "number" || x !== x) { t = (Math.imul(t, 31) + String(x).length) | 0; continue; } B.setFloat64(0, x); t = (Math.imul(t, 31) + B.getInt32(0)) | 0; t = (Math.imul(t, 31) + B.getInt32(4)) | 0; } return v.length + ":" + h + ":" + t; }

function make() { var width, height, rowSize; function set(w, h, s) { width = w; height = h; rowSize = s; }
function solve(x, x0, a, c) {
  var invC = 1 / c;
  for (var k = 0; k < 2; k++) {
    for (var j = 1; j <= height; j++) {
      var lastRow = (j - 1) * rowSize;
      var currentRow = j * rowSize;
      var nextRow = (j + 1) * rowSize;
      var lastX = x[currentRow];
      ++currentRow;
      for (var i = 1; i <= width; i++)
        lastX = x[currentRow] = (x0[currentRow] + a*(lastX+x[++currentRow]+x[++lastRow]+x[++nextRow])) * invC;
    }
    x[0] = 0.5 * (x[1] + x[rowSize]);
  }
}
return { set, solve }; }
const nest = make();
function run(x, x0, a, c, w, h, s) { nest.set(w, h, s); nest.solve(x, x0, a, c); }
function fill(n, how) { var l = new Array(n); for (var i = 0; i < n; i++) l[i] = how === 0 ? i * 0.37 - 4 : how === 1 ? Math.sin(i) : how === 2 ? 0.5 : how === 3 ? i : how === 4 ? (i & 3 ? i : i * 0.5) : how === 5 ? (i & 1 ? -0 : 1e-310) : 2 ** 53 + i; return l; }
{ const x = fill(277, 1); const x0 = x; x0[71] = NaN; try { run(x, x0, 0.2, 3, 128, 1, 3); run(x, x0, 0.25, 4, 128, 1, 3); } catch (e) { console.log(e.message); } console.log(0, show(x), show(x0)); }
{ const x = fill(114, 5); const x0 = x;  try { run(x, x0, 3, 4, 16, 12, 5); run(x, x0, 0.25, 4, 16, 12, 5); } catch (e) { console.log(e.message); } console.log(1, show(x), show(x0)); }
{ const x = fill(125, 1); const x0 = x; x0.length = x0.length >> 1; try { run(x, x0, 3, 3, 7, 9, 9); run(x, x0, 0.25, 4, 7, 9, 9); } catch (e) { console.log(e.message); } console.log(2, show(x), show(x0)); }
{ const x = fill(3752, 0); const x0 = fill(3752, 1); x.length = x.length >> 1; try { run(x, x0, 0.2, 1, 170, 8, 340); run(x, x0, 0.25, 4, 170, 8, 340); } catch (e) { console.log(e.message); } console.log(3, show(x), show(x0)); }
{ const x = fill(282, 1); const x0 = fill(282, 1); x0[125] = NaN; try { run(x, x0, 1, 3, 128, 5, 2); run(x, x0, 0.25, 4, 128, 5, 2); } catch (e) { console.log(e.message); } console.log(4, show(x), show(x0)); }
{ const x = fill(393, 6); const x0 = x.slice(); x[51] = 1e308; x0[51] = -1e308; try { run(x, x0, 0.25, 1, 33, 7, 35); run(x, x0, 0.25, 4, 33, 7, 35); } catch (e) { console.log(e.message); } console.log(5, show(x), show(x0)); }
{ const x = fill(1149, 0); const x0 = fill(1149, 2); x0[506] = Infinity; try { run(x, x0, -0.5, 0.5, 161, 3, 163); run(x, x0, 0.25, 4, 161, 3, 163); } catch (e) { console.log(e.message); } console.log(6, show(x), show(x0)); }
{ const x = fill(74, 1); const x0 = x; x[18] = -Infinity; x0[10] = Infinity; try { run(x, x0, 3, 1, 7, 4, 8); run(x, x0, 0.25, 4, 7, 4, 8); } catch (e) { console.log(e.message); } console.log(7, show(x), show(x0)); }
{ const x = fill(140, 1); const x0 = fill(140, 1); x0[60] = NaN; try { run(x, x0, 1, 3, 9, 8, 11); run(x, x0, 0.25, 4, 9, 8, 11); } catch (e) { console.log(e.message); } console.log(8, show(x), show(x0)); }
{ const x = fill(1292, 1); const x0 = fill(1292, 2); x.length = x.length >> 1; try { run(x, x0, 0.25, 1, 160, 1, 320); run(x, x0, 0.25, 4, 160, 1, 320); } catch (e) { console.log(e.message); } console.log(9, show(x), show(x0)); }
{ const x = fill(1149, 6); const x0 = fill(1149, 0);  try { run(x, x0, -0.5, 4, 161, 3, 163); run(x, x0, 0.25, 4, 161, 3, 163); } catch (e) { console.log(e.message); } console.log(10, show(x), show(x0)); }
{ const x = fill(210, 4); const x0 = x;  try { run(x, x0, 0.2, 4, 64, 12, 5); run(x, x0, 0.25, 4, 64, 12, 5); } catch (e) { console.log(e.message); } console.log(11, show(x), show(x0)); }
{ const x = fill(113, 1); const x0 = fill(113, 1);  try { run(x, x0, -0.5, 3, 33, 5, 5); run(x, x0, 0.25, 4, 33, 5, 5); } catch (e) { console.log(e.message); } console.log(12, show(x), show(x0)); }
{ const x = fill(348, 4); const x0 = x.slice();  try { run(x, x0, 0.2, 1, 159, 7, 2); run(x, x0, 0.25, 4, 159, 7, 2); } catch (e) { console.log(e.message); } console.log(13, show(x), show(x0)); }
{ const x = fill(342, 1); const x0 = fill(342, 1); x0[117] = NaN; try { run(x, x0, 3, 0.5, 161, 2, 2); run(x, x0, 0.25, 4, 161, 2, 2); } catch (e) { console.log(e.message); } console.log(14, show(x), show(x0)); }
{ const x = fill(339, 4); const x0 = fill(339, 1); x.length = x.length >> 1; try { run(x, x0, 0.2, 4, 161, 3, 1); run(x, x0, 0.25, 4, 161, 3, 1); } catch (e) { console.log(e.message); } console.log(15, show(x), show(x0)); }
{ const x = fill(107, 0); const x0 = fill(107, 1); x[48] = -Infinity; x0[64] = Infinity; try { run(x, x0, 3, 1, 9, 5, 11); run(x, x0, 0.25, 4, 9, 5, 11); } catch (e) { console.log(e.message); } console.log(16, show(x), show(x0)); }
{ const x = fill(150, 0); const x0 = fill(150, 2); x0[35] = NaN; try { run(x, x0, 3, 3, 64, 8, 1); run(x, x0, 0.25, 4, 64, 8, 1); } catch (e) { console.log(e.message); } console.log(17, show(x), show(x0)); }
{ const x = fill(3828, 6); const x0 = fill(3828, 5);  try { run(x, x0, 0.2, 0.5, 159, 9, 318); run(x, x0, 0.25, 4, 159, 9, 318); } catch (e) { console.log(e.message); } console.log(18, show(x), show(x0)); }
{ const x = fill(315, 0); const x0 = x; x0[152] = Infinity; try { run(x, x0, 3, 4, 64, 3, 35); run(x, x0, 0.25, 4, 64, 3, 35); } catch (e) { console.log(e.message); } console.log(19, show(x), show(x0)); }
{ const x = fill(53, 0); const x0 = fill(53, 1); x0.length = x0.length >> 1; try { run(x, x0, -0.5, 1, 7, 7, 3); run(x, x0, 0.25, 4, 7, 7, 3); } catch (e) { console.log(e.message); } console.log(20, show(x), show(x0)); }
{ const x = fill(40, 1); const x0 = x; x0[5] = NaN; try { run(x, x0, 3, 4, 7, 12, 1); run(x, x0, 0.25, 4, 7, 12, 1); } catch (e) { console.log(e.message); } console.log(21, show(x), show(x0)); }
{ const x = fill(323, 0); const x0 = fill(323, 2); x[36] = -Infinity; x0[46] = Infinity; try { run(x, x0, 3, 4, 33, 5, 35); run(x, x0, 0.25, 4, 33, 5, 35); } catch (e) { console.log(e.message); } console.log(22, show(x), show(x0)); }
{ const x = fill(332, 6); const x0 = fill(332, 0); x0[108] = Infinity; try { run(x, x0, 0.25, 0.5, 160, 7, 0); run(x, x0, 0.25, 4, 160, 7, 0); } catch (e) { console.log(e.message); } console.log(23, show(x), show(x0)); }
