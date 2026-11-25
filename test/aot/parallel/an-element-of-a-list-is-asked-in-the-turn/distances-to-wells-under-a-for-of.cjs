const stalls = JSON.parse('[[1,2],[3,4.5],[5,6],[2,2],[7.5,1],[0,9]]'), marks = JSON.parse('[0,0,0]');
function nearest(points, t, count) {
  const wells = [];
  for (let k = 0; k < count.length; k++) wells.push(points[(t + k * 2) % 6]);
  let out = 0;
  for (const p of points) {
    let best = 0, least = Infinity;
    for (let c = 0; c < wells.length; c++) {
      const dx = p[0] - wells[c][0], dy = p[1] - wells[c][1], v = dx * dx + dy * dy;
      if (v < least) { least = v; best = c; }
    }
    out += best;
  }
  return out;
}
const ways = { nearest, idle(points, t) { return t; } }, steps = JSON.parse('["nearest"]');
let sum = 0;
for (let t = 0; t < 500; t++) sum = (sum + ways[steps[0]](stalls, t, marks)) % 1000003;
const holed = [[1, , 3], [2], [3, 3], [4, 4], [5, 5], [6, 6]];
const texts = [[1, "2"], [2, 2], ["3", 3], [4, 4], [5, 5], [6, 6]];
const seen = [];
const watched = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]];
Object.defineProperty(watched[2], 0, { get() { seen.push("read"); return 9; } });
let thrown = "";
try { ways[steps[0]]([[1, 1], null, [3, 3], [4, 4], [5, 5], [6, 6]], 0, marks); } catch (error) { thrown = error.constructor.name; }
console.log(sum, ways[steps[0]](holed, 0, marks), ways[steps[0]](texts, 1, marks), ways[steps[0]](watched, 0, marks), seen.length, thrown);
