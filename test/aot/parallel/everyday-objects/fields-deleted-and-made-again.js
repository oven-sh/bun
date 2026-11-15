// A field is deleted and stored again, so it comes last
function change(value, times) {
  const item = { a: value, b: value + 1, c: value + 2 };
  for (let i = 0; i < times; i++) {
    const old = item.a;
    delete item.a;
    if ("a" in item) return "still there";
    item.a = old + item.b;
  }
  return JSON.stringify(item);
}
console.log(change(1, 0));
console.log(change(2, 1));
console.log(change(3, 4));
