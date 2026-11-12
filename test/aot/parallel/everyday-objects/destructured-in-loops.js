// Records taken apart by the head of a loop, with a computed key
function total(rows, key) {
  let sum = 0;
  const names = [];
  for (const { name: label, [key]: value = 100, ...others } of rows) {
    sum += value;
    names.push(label + Object.keys(others).length);
  }
  return names.join() + " " + sum;
}
const rows = [{ name: "a", x: 1, y: 2 }, { name: "b", y: 20 }, { name: "c", x: 3, y: 30, z: 4 }];
console.log(total(rows, "x"));
console.log(total(rows, "y"));
console.log(total(rows, "none"));
