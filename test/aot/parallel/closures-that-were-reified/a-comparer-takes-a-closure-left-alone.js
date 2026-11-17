function tag() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work + 6;
}
function compare(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return a() - b() + work - 1;
}
function main() {
  const list = [];
  for (let i = 0; i < 4; i++) list.push(tag);
  let total = 0;
  for (let turn = 0; turn < 200; turn++) {
    list.sort(compare);
    total += list.length;
  }
  return "object " + total + " " + list[0]();
}
console.log(main());
