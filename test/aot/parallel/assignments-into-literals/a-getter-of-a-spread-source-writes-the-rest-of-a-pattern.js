// STATISTIC: OwnKeyWalksExpanded >= 1
let held = { id: 0, a: 0, b: 0 };
const tricky = { get z() { held.a = 10; return 3; } };
function take(first, start) {
  held = { id: 1, a: start, b: 2 };
  const mixed = { ...first, ...held };
  const { id, ...others } = held;
  return mixed.a + "/" + others.a + "/" + id + "/" + Object.keys(others).join();
}
for (const first of [{ z: 1 }, tricky, { z: 1 }]) console.log(take(first, 1));
