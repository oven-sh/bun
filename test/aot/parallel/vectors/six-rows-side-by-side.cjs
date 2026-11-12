const B = new DataView(new ArrayBuffer(8));
function show(v) { let t = 17, h = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; if (!(i in v)) { h++; continue; } if (typeof x !== "number" || x !== x) { t = (Math.imul(t, 31) + String(x).length) | 0; continue; } B.setFloat64(0, x); t = (Math.imul(t, 31) + B.getInt32(0)) | 0; t = (Math.imul(t, 31) + B.getInt32(4)) | 0; } return v.length + ":" + h + ":" + t; }

function make() { var width, height, rowSize; function set(w, h, s) { width = w; height = h; rowSize = s; }
function solve(x, x0, a, c) {
  var invC = 1 / c;
  for (var q = 0; q < 1; q++) {
    for (var j = 1; j <= height; j++) {
      var lastRow = (j - 1) * rowSize;
      var currentRow = j * rowSize;
      var nextRow = (j + 1) * rowSize;
      var lastX = x[currentRow];
      var u0 = (j * 7) | 0;
      ++currentRow;
      for (var i = 1; i <= width; i++)
        lastX = x[currentRow] = ((x0[currentRow] + a*(lastX+x[++currentRow]+x[++lastRow]+x[++nextRow])) * invC) * (u0 * 0.125 + 1);
      
    }
  }
}
return { set, solve }; }
const nest = make();
function run(x, x0, a, c, w, h, s) { nest.set(w, h, s); return nest.solve(x, x0, a, c); }
function fill(n, how) { var l = new Array(n); for (var i = 0; i < n; i++) l[i] = how === 0 ? i * 0.37 - 4 : how === 1 ? Math.sin(i) : how === 2 ? 0.5 : how === 3 ? i : how === 4 ? (i & 3 ? i : i * 0.5) : (i & 1 ? -0 : 1e-310); return l; }
{ const x = fill(170, 4); const x0 = x; x0[37] = NaN; try { run(x, x0, 0.25, 4, 16, 5, 18); run(x, x0, 0.25, 4, 16, 5, 18); } catch (e) { console.log(e.message); } console.log(0, show(x), show(x0)); }
{ const x = fill(98, 3); const x0 = x.slice();  try { run(x, x0, 0.2, 3, 33, 8, 2); run(x, x0, 0.25, 4, 33, 8, 2); } catch (e) { console.log(e.message); } console.log(1, show(x), show(x0)); }
{ const x = fill(180, 3); const x0 = fill(180, 1); x[91] = NaN; try { run(x, x0, -0.5, 4, 16, 6, 17); run(x, x0, 0.25, 4, 16, 6, 17); } catch (e) { console.log(e.message); } console.log(2, show(x), show(x0)); }
{ const x = fill(2584, 0); const x0 = x; x.length = x.length >> 1; try { run(x, x0, 0.2, 3, 159, 12, 161); run(x, x0, 0.25, 4, 159, 12, 161); } catch (e) { console.log(e.message); } console.log(3, show(x), show(x0)); }
{ const x = fill(164, 5); const x0 = x.slice();  try { run(x, x0, 0.2, 4, 16, 13, 8); run(x, x0, 0.25, 4, 16, 13, 8); } catch (e) { console.log(e.message); } console.log(4, show(x), show(x0)); }
{ const x = fill(1436, 4); const x0 = fill(1436, 0); x0[866] = NaN; try { run(x, x0, 0.2, 3, 159, 12, 79); run(x, x0, 0.25, 4, 159, 12, 79); } catch (e) { console.log(e.message); } console.log(5, show(x), show(x0)); }
{ const x = fill(668, 4); const x0 = fill(668, 5); x.length = x.length >> 1; try { run(x, x0, 0.25, 4, 64, 6, 66); run(x, x0, 0.25, 4, 64, 6, 66); } catch (e) { console.log(e.message); } console.log(6, show(x), show(x0)); }
{ const x = fill(24, 0); const x0 = fill(24, 1);  try { run(x, x0, -0.5, 4, 1, 2, 0); run(x, x0, 0.25, 4, 1, 2, 0); } catch (e) { console.log(e.message); } console.log(7, show(x), show(x0)); }
{ const x = fill(140, 1); const x0 = fill(140, 0); x0[47] = Infinity; try { run(x, x0, 0.2, 4, 64, 12, 0); run(x, x0, 0.25, 4, 64, 12, 0); } catch (e) { console.log(e.message); } console.log(8, show(x), show(x0)); }
{ const x = fill(116, 0); const x0 = fill(116, 1);  try { run(x, x0, -0.5, 4, 16, 2, 18); run(x, x0, 0.25, 4, 16, 2, 18); } catch (e) { console.log(e.message); } console.log(9, show(x), show(x0)); }
{ const x = fill(1940, 0); const x0 = fill(1940, 2); x[162] = NaN; try { run(x, x0, 0.2, 4, 159, 8, 161); run(x, x0, 0.25, 4, 159, 8, 161); } catch (e) { console.log(e.message); } console.log(10, show(x), show(x0)); }
{ const x = fill(1638, 0); const x0 = fill(1638, 0); x[269] = NaN; try { run(x, x0, 0.2, 4, 161, 6, 163); run(x, x0, 0.25, 4, 161, 6, 163); } catch (e) { console.log(e.message); } console.log(11, show(x), show(x0)); }
{ const x = fill(1300, 0); const x0 = fill(1300, 1); x0[527] = NaN; try { run(x, x0, -0.5, 4, 161, 4, 161); run(x, x0, 0.25, 4, 161, 4, 161); } catch (e) { console.log(e.message); } console.log(12, show(x), show(x0)); }
{ const x = fill(1526, 4); const x0 = x;  try { run(x, x0, 0.25, 4, 64, 19, 66); run(x, x0, 0.25, 4, 64, 19, 66); } catch (e) { console.log(e.message); } console.log(13, show(x), show(x0)); }
{ const x = fill(2584, 3); const x0 = x; x0[810] = Infinity; try { run(x, x0, 0.25, 3, 159, 12, 161); run(x, x0, 0.25, 4, 159, 12, 161); } catch (e) { console.log(e.message); } console.log(14, show(x), show(x0)); }
{ const x = fill(982, 4); const x0 = fill(982, 2);  try { run(x, x0, 0.25, 3, 161, 2, 162); run(x, x0, 0.25, 4, 161, 2, 162); } catch (e) { console.log(e.message); } console.log(15, show(x), show(x0)); }
