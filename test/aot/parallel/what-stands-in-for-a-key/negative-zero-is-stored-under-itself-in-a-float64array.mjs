function fill(list, from) {
  for (let i = from | 0; i < 0; i++) { const key = i % 4; list[key] = key; }
  return list;
}
const from = Number(process.env.NO_SUCH ?? -4);
const view = fill(new Float64Array(4), from);
console.log(Object.is(view[0], -0));
