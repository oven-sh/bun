// Lists reversed by pops and by a counter that goes down, both pushed
function both(list) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    const copy = list.slice();
    while (copy.length > 1) out.push(copy.pop());
    for (let k = 3; k >= 0; k--) {
      out.push(list[k]);
    }
    out.push(copy[0] + i);
  }
  return out.join();
}
console.log(both([1, 2, 3, 4]));
console.log(both([40, 30, 20, 10]));
console.log(both([0, -1, 0, -1]));
