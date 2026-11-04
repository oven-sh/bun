function outer(tag: number) { return f; function f() { return tag; } }
function turns(n: number) {
  const list: Array<() => number> = [];
  for (let i = 0; i < n; i++) { list.push(f); list.push(f); function f() { return i; } }
  return list.map(g => g()).join("") + ":" + (list[0] === list[1]) + ":" + (list[0] === list[2]);
}
console.log(outer(1) === outer(1), outer(1)() + outer(2)(), turns(3));
