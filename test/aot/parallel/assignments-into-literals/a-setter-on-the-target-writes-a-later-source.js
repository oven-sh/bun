let later = { a: 0, b: 0 };
function merge(first, start) {
  later = { a: start, b: 2 };
  const target = { id: 7, set z(v) { later.a = v * 10; }, a: 0, b: 0 };
  return Object.assign(target, first, later);
}
for (const first of [{ y: 1 }, { z: 3 }, JSON.parse('{"z":4}')]) { const made = merge(first, 1); console.log(made.a, made.b, made.id); }
