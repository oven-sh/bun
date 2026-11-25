// Bun.inspect lists an object that lost many properties by its own keys, names first, and a copy has that order too.
const mark = Symbol("mark");
for (const count of [20, 300]) {
  const o = {};
  for (let i = 0; i < count; i++) o["n" + i] = i;
  o[mark] = 1;
  o.behind = 2;
  for (let i = 0; i < count - 2; i++) delete o["n" + i];
  o.late = 3;
  for (const it of [o, { ...o }, Object.assign({}, o), Object.assign({ first: 0 }, o)]) console.log(count, Bun.inspect(it));
}
