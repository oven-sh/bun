// `if (i in list) list[i] = f(list[i])`: each iteration of the specialized version leaves it for the generic one, which enters it again: a poll stays on that way.
// Under: --aot-harden=proof-checks: the iterations that leave are others
function unpack(value, memo) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (i in value) value[i] = unpack(value[i], memo);
    }
    return value;
  }
  for (const key of Object.keys(value)) value[key] = unpack(value[key], memo);
  return value;
}
console.log(JSON.stringify(unpack(JSON.parse('[1, [2, {"a": [3, null, {"b": [4]}]}], "t"]'), new Map())));
function count(value) { let n = 0; for (let i = 0; i < value.length; i++) if (i in value) n += Number(value[i]); return n; }
console.log(count([1, , 3, "4"]), count("text".split("")), count({ length: 3, 1: 5 }));
