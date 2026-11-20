function fill(list, from) {
  for (let i = from | 0; i < 0; i++) { const key = i % 4; list[key] = key; }
  return list;
}
const from = Number(process.env.NO_SUCH ?? -4);
const made = fill([1, 2, 3, 4], from);
console.log(Object.is(made[0], -0), 1 / made[0]);
