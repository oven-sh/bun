// Lists kept in a Map, pushed to in an inner loop and read while others grow
function group(pairs) {
  const groups = new Map();
  for (const [key, values] of pairs) {
    for (const value of values) {
      let list = groups.get(key);
      if (list === undefined) groups.set(key, (list = []));
      list.push(value);
      if (groups.size > 1) for (const other of groups.values()) if (other !== list && other.length < 3) other.push(list.length);
    }
  }
  return [...groups].map(([key, list]) => String(key) + "=" + list.join("+")).join(" ");
}
console.log(group([["a", [1, 2]], ["b", [3]], ["a", [4]]]));
console.log(group([[1, ["x"]], [1.5, ["y", "z"]], [NaN, [0]], [NaN, [-0]]]));
console.log(group([]), group([[null, [null]], [undefined, [undefined, 1]]]));
