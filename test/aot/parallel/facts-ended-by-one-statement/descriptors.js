function make(v) {
  return { v, w: v + 1 };
}
const items = [make(1), make(2), make(3)];
function sum() {
  let text = "";
  for (const item of items) {
    item.w = 5;
    text += item.v + item.w + ",";
  }
  return text;
}
console.log(sum());
Object.defineProperties(items[0], {
  w: {
    get() {
      return 70;
    },
    set(x) {
      console.log("set", x);
    },
  },
});
Object.defineProperty(items[1], "v", { value: 8, enumerable: false });
Object.defineProperty(items[2], "x", { get: () => "x" });
console.log(sum(), Object.keys(items[1]).join(), items[2].x, JSON.stringify(items));
