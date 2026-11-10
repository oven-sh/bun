function renamed(record, name) {
  const copy = { ...record };
  copy.name = name;
  return copy;
}
const first = { name: "oak", rings: 80 };
const second = renamed(first, "yew");
console.log(first.name, second.name, second.rings);
