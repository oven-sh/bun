function hold(...xs) { return xs; }
for (let i = 0; i < 3; i++) {
  const shared = { n: i };
  let local = i;
  const held = hold(shared, local);
  shared.n += 10;
  local += 10;
  console.log(held[0].n, held[1], local);
}
