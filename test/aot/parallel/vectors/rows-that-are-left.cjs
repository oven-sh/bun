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
{ const x = fill(823, 1); const x0 = x; x0[205] = NaN; try { run(x, x0, 3, 0.5, 161, 1, 163); run(x, x0, 0.25, 4, 161, 1, 163); } catch (e) { console.log(e.message); } console.log(0, show(x), show(x0)); }
{ const x = fill(26, 1); const x0 = x.slice();  try { run(x, x0, 0.25, 0.5, 1, 4, 2); run(x, x0, 0.25, 4, 1, 4, 2); } catch (e) { console.log(e.message); } console.log(1, show(x), show(x0)); }
{ const x = fill(2088, 1); const x0 = fill(2088, 2); x[590] = -Infinity; x0[394] = Infinity; try { run(x, x0, 1, 0.5, 128, 12, 130); run(x, x0, 0.25, 4, 128, 12, 130); } catch (e) { console.log(e.message); } console.log(2, show(x), show(x0)); }
{ const x = fill(352, 0); const x0 = x.slice(); x0.length = x0.length >> 1; try { run(x, x0, 3, 1, 170, 12, 0); run(x, x0, 0.25, 4, 170, 12, 0); } catch (e) { console.log(e.message); } console.log(3, show(x), show(x0)); }
{ const x = fill(1466, 6); const x0 = x.slice(); x[644] = NaN; try { run(x, x0, 3, 0.5, 160, 5, 162); run(x, x0, 0.25, 4, 160, 5, 162); } catch (e) { console.log(e.message); } console.log(4, show(x), show(x0)); }
{ const x = fill(74, 3); const x0 = x.slice(); x[28] = -Infinity; x0[16] = Infinity; try { run(x, x0, 3, 0.5, 9, 9, 4); run(x, x0, 0.25, 4, 9, 9, 4); } catch (e) { console.log(e.message); } console.log(5, show(x), show(x0)); }
{ const x = fill(59, 4); const x0 = x; x.length = x.length >> 1; try { run(x, x0, 3, 3, 1, 7, 5); run(x, x0, 0.25, 4, 1, 7, 5); } catch (e) { console.log(e.message); } console.log(6, show(x), show(x0)); }
{ const x = fill(788, 0); const x0 = fill(788, 1); x[167] = 1e308; x0[305] = -1e308; try { run(x, x0, 0.2, 3, 128, 2, 130); run(x, x0, 0.25, 4, 128, 2, 130); } catch (e) { console.log(e.message); } console.log(7, show(x), show(x0)); }
{ const x = fill(89, 3); const x0 = fill(89, 5); Object.freeze(x0); try { run(x, x0, 0.2, 4, 7, 5, 9); run(x, x0, 0.25, 4, 7, 5, 9); } catch (e) { console.log(e.message); } console.log(8, show(x), show(x0)); }
{ const x = fill(32, 3); const x0 = x; x0[7] = NaN; try { run(x, x0, 1, 3, 7, 4, 1); run(x, x0, 0.25, 4, 7, 4, 1); } catch (e) { console.log(e.message); } console.log(9, show(x), show(x0)); }
{ const x = fill(37, 0); const x0 = fill(37, 0);  try { run(x, x0, -0.5, 3, 8, 1, 3); run(x, x0, 0.25, 4, 8, 1, 3); } catch (e) { console.log(e.message); } console.log(10, show(x), show(x0)); }
{ const x = fill(2732, 0); const x0 = fill(2732, 1); x[1812] = 1e308; x0[1422] = -1e308; try { run(x, x0, 0.25, 0.5, 170, 5, 340); run(x, x0, 0.25, 4, 170, 5, 340); } catch (e) { console.log(e.message); } console.log(11, show(x), show(x0)); }
{ const x = fill(74, 6); const x0 = fill(74, 0); x0[31] = NaN; try { run(x, x0, 3, 3, 9, 2, 11); run(x, x0, 0.25, 4, 9, 2, 11); } catch (e) { console.log(e.message); } console.log(12, show(x), show(x0)); }
{ const x = fill(374, 0); const x0 = x; x.length = x.length >> 1; try { run(x, x0, 0.2, 0.5, 160, 12, 3); run(x, x0, 0.25, 4, 160, 12, 3); } catch (e) { console.log(e.message); } console.log(13, show(x), show(x0)); }
{ const x = fill(168, 3); const x0 = x; x0[59] = Infinity; try { run(x, x0, -0.5, 4, 64, 12, 2); run(x, x0, 0.25, 4, 64, 12, 2); } catch (e) { console.log(e.message); } console.log(14, show(x), show(x0)); }
{ const x = fill(282, 3); const x0 = fill(282, 1); x0[87] = NaN; try { run(x, x0, -0.5, 3, 33, 4, 34); run(x, x0, 0.25, 4, 33, 4, 34); } catch (e) { console.log(e.message); } console.log(15, show(x), show(x0)); }
{ const x = fill(814, 6); const x0 = fill(814, 1); x0[243] = NaN; try { run(x, x0, 0.25, 1, 161, 1, 160); run(x, x0, 0.25, 4, 161, 1, 160); } catch (e) { console.log(e.message); } console.log(16, show(x), show(x0)); }
{ const x = fill(737, 1); const x0 = x; x[176] = NaN; try { run(x, x0, 0.2, 0.5, 128, 5, 67); run(x, x0, 0.25, 4, 128, 5, 67); } catch (e) { console.log(e.message); } console.log(17, show(x), show(x0)); }
{ const x = fill(140, 5); const x0 = fill(140, 2); x0[24] = NaN; try { run(x, x0, 0.2, 1, 9, 8, 11); run(x, x0, 0.25, 4, 9, 8, 11); } catch (e) { console.log(e.message); } console.log(18, show(x), show(x0)); }
{ const x = fill(1952, 0); const x0 = x; x0[728] = Infinity; try { run(x, x0, 1, 1, 160, 8, 162); run(x, x0, 0.25, 4, 160, 8, 162); } catch (e) { console.log(e.message); } console.log(19, show(x), show(x0)); }
{ const x = fill(358, 4); const x0 = x; x[86] = 1e308; x0[111] = -1e308; try { run(x, x0, -0.5, 0.5, 170, 1, 2); run(x, x0, 0.25, 4, 170, 1, 2); } catch (e) { console.log(e.message); } console.log(20, show(x), show(x0)); }
{ const x = fill(1468, 0); const x0 = x; x[590] = NaN; try { run(x, x0, -0.5, 1, 161, 5, 162); run(x, x0, 0.25, 4, 161, 5, 162); } catch (e) { console.log(e.message); } console.log(21, show(x), show(x0)); }
{ const x = fill(1212, 0); const x0 = x; x0[329] = NaN; try { run(x, x0, -0.5, 0.5, 170, 3, 172); run(x, x0, 0.25, 4, 170, 3, 172); } catch (e) { console.log(e.message); } console.log(22, show(x), show(x0)); }
{ const x = fill(51, 1); const x0 = fill(51, 0); Object.freeze(x0); try { run(x, x0, 3, 0.5, 9, 1, 7); run(x, x0, 0.25, 4, 9, 1, 7); } catch (e) { console.log(e.message); } console.log(23, show(x), show(x0)); }
