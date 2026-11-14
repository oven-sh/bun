// Lists in a Map that both levels push elements onto
function fill(keys, values) {
  const map = new Map();
  for (const key of keys) map.set(key, []);
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      map.get(keys[k]).push(values[i]);
    }
    map.get(keys[i]).push(values[0] * 2);
  }
  return [...map].map(([key, list]) => key + list.join("+")).join(" ");
}
console.log(fill(["a", "b", "c"], [1, 2, 3]));
console.log(fill([1, 1.5, "1"], [0.5, -0, 3]));
console.log(fill(["x", "y", "x"], [7, 8, 9]), fill([null, undefined, NaN], ["2", "p", "q"]));
