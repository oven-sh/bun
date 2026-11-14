// Reduce that fills an object of lists, inside a loop over keys
function byKeys(rows, keys) {
  const out = [];
  for (const key of keys) {
    const groups = rows.reduce((all, row, i) => {
      (all[row[key]] = all[row[key]] || []).push(i);
      return all;
    }, {});
    for (const name in groups) out.push(key + "." + name + ":" + groups[name].join("+"));
  }
  return out.join(" ");
}
const people = [{ age: 3, name: "a" }, { age: 4, name: "b" }, { age: 3, name: "a", extra: 1 }];
console.log(byKeys(people, ["age", "name"]));
console.log(byKeys(people, ["extra", "none"]));
console.log(byKeys([], ["x"]), byKeys([{ k: 1.5 }, { k: "1.5" }, { k: null }], ["k"]));
