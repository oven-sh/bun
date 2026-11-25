// Objects pushed at both levels, changed through the list afterwards
function items(name) {
  const list = [];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) list.push({ name, i, k });
    list.push({ name: name + i, total: list.length });
    list[i].seen = (list[i].seen || 0) + 1;
    if (i === 1) list[0].i = "changed";
  }
  return list.map(item => Object.values(item).join("")).join(" ");
}
console.log(items("a"));
console.log(items(1.5));
console.log(items(null), items(7));
