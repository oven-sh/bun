const B = new DataView(new ArrayBuffer(8));
function show(v) { let t = 17, h = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; if (!(i in v)) { h++; continue; } if (typeof x !== "number" || x !== x) { t = (Math.imul(t, 31) + String(x).length) | 0; continue; } B.setFloat64(0, x); t = (Math.imul(t, 31) + B.getInt32(0)) | 0; t = (Math.imul(t, 31) + B.getInt32(4)) | 0; } return v.length + ":" + h + ":" + t; }

function make() { var width, height, rowSize; function set(w, h, s) { width = w; height = h; rowSize = s; }
function solve(x, x0, a, c) {
  var invC = 1 / c;
  for (var k = 0; k < 3; k++) {
    for (var j = 1; j <= height; j++) {
      var lastRow = (j - 1) * rowSize;
      var currentRow = j * rowSize;
      var nextRow = (j + 1) * rowSize;
      var lastX = x[currentRow];
      ++currentRow;
      for (var i = 1; i <= width; i++)
        lastX = x[currentRow] = (x0[currentRow] + (lastX+x[++currentRow]-x[++lastRow]*0.5+x[++nextRow]) / c) * a;
    }
    
  }
}
return { set, solve }; }
const nest = make();
function run(x, x0, a, c, w, h, s) { nest.set(w, h, s); nest.solve(x, x0, a, c); }
function fill(n, how) { var l = new Array(n); for (var i = 0; i < n; i++) l[i] = how === 0 ? i * 0.37 - 4 : how === 1 ? Math.sin(i) : how === 2 ? 0.5 : how === 3 ? i : how === 4 ? (i & 3 ? i : i * 0.5) : how === 5 ? (i & 1 ? -0 : 1e-310) : 2 ** 53 + i; return l; }
{ const x = fill(152, 1); const x0 = fill(152, 1); x[21] = 1e308; x0[20] = -1e308; try { run(x, x0, 1, 3, 7, 12, 9); run(x, x0, 0.25, 4, 7, 12, 9); } catch (e) { console.log(e.message); } console.log(0, show(x), show(x0)); }
{ const x = fill(978, 1); const x0 = fill(978, 1); x0.length = x0.length >> 1; try { run(x, x0, 3, 4, 161, 2, 161); run(x, x0, 0.25, 4, 161, 2, 161); } catch (e) { console.log(e.message); } console.log(1, show(x), show(x0)); }
{ const x = fill(1568, 0); const x0 = fill(1568, 0); x0[372] = NaN; try { run(x, x0, 3, 3, 128, 8, 130); run(x, x0, 0.25, 4, 128, 8, 130); } catch (e) { console.log(e.message); } console.log(2, show(x), show(x0)); }
{ const x = fill(352, 0); const x0 = x; x0.length = x0.length >> 1; try { run(x, x0, 1, 0.5, 161, 7, 2); run(x, x0, 0.25, 4, 161, 7, 2); } catch (e) { console.log(e.message); } console.log(3, show(x), show(x0)); }
{ const x = fill(84, 1); const x0 = fill(84, 2); x0[22] = NaN; try { run(x, x0, 1, 0.5, 9, 4, 9); run(x, x0, 0.25, 4, 9, 4, 9); } catch (e) { console.log(e.message); } console.log(4, show(x), show(x0)); }
{ const x = fill(353, 0); const x0 = x;  try { run(x, x0, 0.2, 4, 160, 5, 3); run(x, x0, 0.25, 4, 160, 5, 3); } catch (e) { console.log(e.message); } console.log(5, show(x), show(x0)); }
{ const x = fill(463, 1); const x0 = x; x0[58] = NaN; try { run(x, x0, 1, 3, 33, 9, 35); run(x, x0, 0.25, 4, 33, 9, 35); } catch (e) { console.log(e.message); } console.log(6, show(x), show(x0)); }
{ const x = fill(1064, 0); const x0 = x; x.length = x.length >> 1; try { run(x, x0, 3, 3, 64, 12, 66); run(x, x0, 0.25, 4, 64, 12, 66); } catch (e) { console.log(e.message); } console.log(7, show(x), show(x0)); }
{ const x = fill(168, 0); const x0 = fill(168, 5); x0.length = x0.length >> 1; try { run(x, x0, 1, 0.5, 8, 12, 10); run(x, x0, 0.25, 4, 8, 12, 10); } catch (e) { console.log(e.message); } console.log(8, show(x), show(x0)); }
{ const x = fill(352, 4); const x0 = fill(352, 0); x0[127] = NaN; try { run(x, x0, -0.5, 4, 170, 9, 0); run(x, x0, 0.25, 4, 170, 9, 0); } catch (e) { console.log(e.message); } console.log(9, show(x), show(x0)); }
{ const x = fill(89, 5); const x0 = fill(89, 0);  try { run(x, x0, -0.5, 3, 7, 5, 9); run(x, x0, 0.25, 4, 7, 5, 9); } catch (e) { console.log(e.message); } console.log(10, show(x), show(x0)); }
{ const x = fill(986, 1); const x0 = fill(986, 1); x[185] = 1e308; x0[342] = -1e308; try { run(x, x0, 0.25, 4, 161, 2, 163); run(x, x0, 0.25, 4, 161, 2, 163); } catch (e) { console.log(e.message); } console.log(11, show(x), show(x0)); }
{ const x = fill(460, 1); const x0 = x.slice(); x0.length = x0.length >> 1; try { run(x, x0, -0.5, 0.5, 64, 8, 32); run(x, x0, 0.25, 4, 64, 8, 32); } catch (e) { console.log(e.message); } console.log(12, show(x), show(x0)); }
{ const x = fill(242, 6); const x0 = fill(242, 5); x.length = x.length >> 1; try { run(x, x0, 1, 0.5, 16, 9, 18); run(x, x0, 0.25, 4, 16, 9, 18); } catch (e) { console.log(e.message); } console.log(13, show(x), show(x0)); }
{ const x = fill(1284, 1); const x0 = fill(1284, 2); x0[601] = NaN; try { run(x, x0, 1, 1, 159, 4, 159); run(x, x0, 0.25, 4, 159, 4, 159); } catch (e) { console.log(e.message); } console.log(14, show(x), show(x0)); }
{ const x = fill(14, 1); const x0 = x.slice(); x[1] = -Infinity; x0[1] = Infinity; try { run(x, x0, -0.5, 1, 1, 1, 0); run(x, x0, 0.25, 4, 1, 1, 0); } catch (e) { console.log(e.message); } console.log(15, show(x), show(x0)); }
{ const x = fill(98, 1); const x0 = x; x0[34] = NaN; try { run(x, x0, 1, 0.5, 8, 8, 7); run(x, x0, 0.25, 4, 8, 8, 7); } catch (e) { console.log(e.message); } console.log(16, show(x), show(x0)); }
{ const x = fill(1312, 6); const x0 = fill(1312, 2); x0.length = x0.length >> 1; try { run(x, x0, 0.2, 0.5, 161, 4, 163); run(x, x0, 0.25, 4, 161, 4, 163); } catch (e) { console.log(e.message); } console.log(17, show(x), show(x0)); }
{ const x = fill(44, 0); const x0 = fill(44, 0); x[12] = 1e308; x0[15] = -1e308; try { run(x, x0, 1, 1, 7, 4, 3); run(x, x0, 0.25, 4, 7, 4, 3); } catch (e) { console.log(e.message); } console.log(18, show(x), show(x0)); }
{ const x = fill(242, 0); const x0 = fill(242, 0); x0[31] = Infinity; try { run(x, x0, 0.25, 4, 16, 9, 18); run(x, x0, 0.25, 4, 16, 9, 18); } catch (e) { console.log(e.message); } console.log(19, show(x), show(x0)); }
{ const x = fill(344, 6); const x0 = fill(344, 2); x[87] = NaN; try { run(x, x0, 3, 3, 159, 5, 2); run(x, x0, 0.25, 4, 159, 5, 2); } catch (e) { console.log(e.message); } console.log(20, show(x), show(x0)); }
{ const x = fill(359, 6); const x0 = fill(359, 0); x0.length = x0.length >> 1; try { run(x, x0, -0.5, 4, 170, 5, 1); run(x, x0, 0.25, 4, 170, 5, 1); } catch (e) { console.log(e.message); } console.log(21, show(x), show(x0)); }
{ const x = fill(672, 5); const x0 = x.slice();  try { run(x, x0, 3, 4, 33, 7, 66); run(x, x0, 0.25, 4, 33, 7, 66); } catch (e) { console.log(e.message); } console.log(22, show(x), show(x0)); }
{ const x = fill(813, 0); const x0 = fill(813, 0); x0.length = x0.length >> 1; try { run(x, x0, 0.2, 1, 159, 1, 161); run(x, x0, 0.25, 4, 159, 1, 161); } catch (e) { console.log(e.message); } console.log(23, show(x), show(x0)); }
