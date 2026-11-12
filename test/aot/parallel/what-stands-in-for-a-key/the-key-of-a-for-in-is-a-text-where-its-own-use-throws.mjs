function show(...all) { return all.map(one => (typeof one)[0] + String(one)).join(" "); }
function run(list, holder) {
  let key = "none";
  try { for (key in list) { const value = holder[key].x; if (value > 100) break; } } catch { return show(key); }
  return "ok";
}
console.log(run([1, 2, 3], [{ x: 1 }, null, { x: 2 }]));
