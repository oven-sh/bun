function mix(h, k) {
  h ^= k;
  return (h << 5) | (h >>> 27);
}
const rows = JSON.parse('[[1, 2.5, "3", 4, null, 5.75, -6, 7e10, true], [], [0.5], ["a"], [1, 2, 3]]');
function go(list) {
  let h = 1;
  for (let i = 0; i < list.length; i++) h = mix(h, list[i]);
  return h;
}
const said = [];
for (let r = 0; r < rows.length; r++) said.push(go(rows[r]));
console.log(said.join());
