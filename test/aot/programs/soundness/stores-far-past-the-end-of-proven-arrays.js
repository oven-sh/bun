const keys = JSON.parse("[1, 4294967294, 2147483647, 100000000, -1, 0.5]");
function fill(list, key) {
  list[key] = "w";
  let text = "";
  for (let i = 0; i < 3; i++) text += list[i] + ",";
  return text + list.length + ":" + Object.keys(list).length;
}
for (const key of keys) console.log(key, fill(["a", "b", "c"], key));
const shared = ["a", "b", "c"];
for (const key of keys) console.log(key, fill(shared, key), shared.indexOf("w"), shared.includes("c"), shared.slice(0, 2).join());
