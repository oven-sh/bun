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
        lastX = x[currentRow] = ((x0[currentRow] * a) + (lastX+x[++currentRow]+x[++nextRow])) * invC;
    }
    
  }
}
return { set, solve }; }
const nest = make();
function run(x, x0, a, c, w, h, s) { nest.set(w, h, s); nest.solve(x, x0, a, c); }
function fill(n, how) { var l = new Array(n); for (var i = 0; i < n; i++) l[i] = how === 0 ? i * 0.37 - 4 : how === 1 ? Math.sin(i) : how === 2 ? 0.5 : how === 3 ? i : how === 4 ? (i & 3 ? i : i * 0.5) : how === 5 ? (i & 1 ? -0 : 1e-310) : 2 ** 53 + i; return l; }
{ const x = fill(1048, 6); const x0 = x.slice(); x[219] = -Infinity; x0[321] = Infinity; try { run(x, x0, 3, 3, 128, 4, 130); run(x, x0, 0.25, 4, 128, 4, 130); } catch (e) { console.log(e.message); } console.log(0, show(x), show(x0)); }
{ const x = fill(38, 6); const x0 = x.slice(); x[13] = -Infinity; x0[7] = Infinity; try { run(x, x0, 1, 3, 8, 8, 1); run(x, x0, 0.25, 4, 8, 8, 1); } catch (e) { console.log(e.message); } console.log(1, show(x), show(x0)); }
{ const x = fill(138, 1); const x0 = x.slice(); x0.length = x0.length >> 1; try { run(x, x0, 1, 0.5, 8, 9, 10); run(x, x0, 0.25, 4, 8, 9, 10); } catch (e) { console.log(e.message); } console.log(2, show(x), show(x0)); }
{ const x = fill(32, 3); const x0 = fill(32, 0); x0[3] = NaN; try { run(x, x0, 0.2, 0.5, 1, 7, 2); run(x, x0, 0.25, 4, 1, 7, 2); } catch (e) { console.log(e.message); } console.log(3, show(x), show(x0)); }
{ const x = fill(1178, 1); const x0 = x.slice(); x0[752] = NaN; try { run(x, x0, 0.25, 0.5, 128, 5, 130); run(x, x0, 0.25, 4, 128, 5, 130); } catch (e) { console.log(e.message); } console.log(4, show(x), show(x0)); }
{ const x = fill(346, 4); const x0 = x;  try { run(x, x0, 1, 0.5, 161, 2, 3); run(x, x0, 0.25, 4, 161, 2, 3); } catch (e) { console.log(e.message); } console.log(5, show(x), show(x0)); }
{ const x = fill(45, 1); const x0 = fill(45, 5); x0[11] = NaN; try { run(x, x0, 0.25, 3, 9, 3, 3); run(x, x0, 0.25, 4, 9, 3, 3); } catch (e) { console.log(e.message); } console.log(6, show(x), show(x0)); }
{ const x = fill(222, 1); const x0 = x.slice(); x0.length = x0.length >> 1; try { run(x, x0, 0.2, 3, 33, 7, 16); run(x, x0, 0.25, 4, 33, 7, 16); } catch (e) { console.log(e.message); } console.log(7, show(x), show(x0)); }
{ const x = fill(78, 0); const x0 = fill(78, 2); x0[13] = Infinity; try { run(x, x0, 0.25, 1, 33, 4, 0); run(x, x0, 0.25, 4, 33, 4, 0); } catch (e) { console.log(e.message); } console.log(8, show(x), show(x0)); }
{ const x = fill(379, 0); const x0 = x.slice(); x0[141] = Infinity; try { run(x, x0, 0.25, 4, 161, 7, 5); run(x, x0, 0.25, 4, 161, 7, 5); } catch (e) { console.log(e.message); } console.log(9, show(x), show(x0)); }
{ const x = fill(140, 1); const x0 = fill(140, 0); x0.length = x0.length >> 1; try { run(x, x0, 1, 4, 16, 1, 32); run(x, x0, 0.25, 4, 16, 1, 32); } catch (e) { console.log(e.message); } console.log(10, show(x), show(x0)); }
{ const x = fill(1940, 1); const x0 = fill(1940, 1); x[403] = -Infinity; x0[929] = Infinity; try { run(x, x0, 0.25, 0.5, 159, 8, 161); run(x, x0, 0.25, 4, 159, 8, 161); } catch (e) { console.log(e.message); } console.log(11, show(x), show(x0)); }
{ const x = fill(1940, 1); const x0 = fill(1940, 5);  try { run(x, x0, 0.25, 4, 159, 8, 161); run(x, x0, 0.25, 4, 159, 8, 161); } catch (e) { console.log(e.message); } console.log(12, show(x), show(x0)); }
{ const x = fill(352, 0); const x0 = x; x[150] = 1e308; x0[150] = -1e308; try { run(x, x0, 0.25, 1, 160, 8, 2); run(x, x0, 0.25, 4, 160, 8, 2); } catch (e) { console.log(e.message); } console.log(13, show(x), show(x0)); }
{ const x = fill(96, 1); const x0 = x.slice(); x0[11] = Infinity; try { run(x, x0, 3, 1, 7, 12, 5); run(x, x0, 0.25, 4, 7, 12, 5); } catch (e) { console.log(e.message); } console.log(14, show(x), show(x0)); }
{ const x = fill(3828, 5); const x0 = x.slice(); x[1421] = -Infinity; x0[1744] = Infinity; try { run(x, x0, 3, 0.5, 159, 9, 318); run(x, x0, 0.25, 4, 159, 9, 318); } catch (e) { console.log(e.message); } console.log(15, show(x), show(x0)); }
{ const x = fill(36, 6); const x0 = x.slice();  try { run(x, x0, 0.2, 0.5, 1, 9, 2); run(x, x0, 0.25, 4, 1, 9, 2); } catch (e) { console.log(e.message); } console.log(16, show(x), show(x0)); }
{ const x = fill(581, 4); const x0 = fill(581, 2); x0.length = x0.length >> 1; try { run(x, x0, -0.5, 0.5, 64, 5, 63); run(x, x0, 0.25, 4, 64, 5, 63); } catch (e) { console.log(e.message); } console.log(17, show(x), show(x0)); }
{ const x = fill(780, 6); const x0 = x.slice(); x[422] = NaN; try { run(x, x0, -0.5, 4, 64, 3, 128); run(x, x0, 0.25, 4, 64, 3, 128); } catch (e) { console.log(e.message); } console.log(18, show(x), show(x0)); }
{ const x = fill(39, 1); const x0 = x; x0[8] = Infinity; try { run(x, x0, -0.5, 4, 9, 7, 1); run(x, x0, 0.25, 4, 9, 7, 1); } catch (e) { console.log(e.message); } console.log(19, show(x), show(x0)); }
{ const x = fill(29, 0); const x0 = x; x0[10] = Infinity; try { run(x, x0, 1, 4, 1, 3, 3); run(x, x0, 0.25, 4, 1, 3, 3); } catch (e) { console.log(e.message); } console.log(20, show(x), show(x0)); }
{ const x = fill(86, 1); const x0 = fill(86, 2);  try { run(x, x0, -0.5, 1, 9, 12, 4); run(x, x0, 0.25, 4, 9, 12, 4); } catch (e) { console.log(e.message); } console.log(21, show(x), show(x0)); }
{ const x = fill(823, 5); const x0 = fill(823, 1); x0[197] = NaN; try { run(x, x0, 0.25, 3, 161, 1, 163); run(x, x0, 0.25, 4, 161, 1, 163); } catch (e) { console.log(e.message); } console.log(22, show(x), show(x0)); }
{ const x = fill(71, 3); const x0 = fill(71, 1);  try { run(x, x0, -0.5, 4, 7, 3, 9); run(x, x0, 0.25, 4, 7, 3, 9); } catch (e) { console.log(e.message); } console.log(23, show(x), show(x0)); }
