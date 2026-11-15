// Labeled exits out of loops that push elements
function until(list, stop) {
  const out = [];
  outer: for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3; k++) {
      out.push(list[k]);
      if (list[k] + i === stop) continue outer;
      if (list[k] * i > stop * 2) break outer;
    }
    out.push(list[i % 3]);
  }
  return out.join() + " " + out.length;
}
console.log(until([1, 2, 3], 3));
console.log(until([5, 15, 25], 26));
console.log(until([9, 9, 9], 100));
