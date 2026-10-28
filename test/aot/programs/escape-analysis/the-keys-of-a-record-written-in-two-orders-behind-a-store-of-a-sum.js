function xy(x, y) {
  return { x, y };
}
function yx(x, y) {
  return { y, x };
}
const rows = JSON.parse('[1,"a"]');
console.log(Object.keys(yx(0, 0)).join());
function walk(read) {
  return rows
    .map(v => {
      const o = xy(0, 0);
      o.x = v + 1;
      return read(o);
    })
    .join(" ");
}
console.log(
  rows
    .map(v => {
      const o = xy(0, 0);
      o.x = v + 1;
      return Object.keys(o).join();
    })
    .join(" "),
);
console.log(
  rows
    .map(v => {
      const o = xy(0, 0);
      o.x = v + 1;
      return Object.values(o).join();
    })
    .join(" "),
);
console.log(
  rows
    .map(v => {
      const o = xy(0, 0);
      o.x = v + 1;
      return Object.entries(o).join();
    })
    .join(" "),
);
console.log(walk(o => JSON.stringify({ ...o })));
