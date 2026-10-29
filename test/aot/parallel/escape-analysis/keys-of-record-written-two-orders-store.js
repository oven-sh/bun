// The keys of a record written in two orders behind a store.
function xy(x, y) {
  return { x, y };
}
function yx(x, y) {
  return { y, x };
}
const rows = JSON.parse('[1,"a"]');
console.log(Object.keys(yx(0, 0)).join());
console.log(
  rows
    .map(v => {
      const o = xy(0, 0);
      o.x = v + 1;
      return Object.keys(o).join();
    })
    .join(" "),
);
