const base = {
  color: "red",
  size() {
    return 1;
  },
};
function make(i) {
  return { i };
}
function show(list) {
  let text = "";
  for (const item of list)
    text += item.i + String(item.color) + (item.size ? item.size() : "-") + ("color" in item) + " ";
  return text;
}
const items = [make(1), make(2)];
console.log(show(items));
Object.setPrototypeOf(items[0], base);
items.push(Object.create(base, { i: { value: 3 } }));
console.log(show(items));
base.color = "blue";
delete base.size;
Object.setPrototypeOf(base, { size: () => 9 });
console.log(show(items));
