// A list that is cut inside the loop that pushes onto it
function cut(at, list) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    out.push(list[i % list.length]);
    if (i === at) out.length = 1;
    for (let k = 0; k < 2; k++) if (out.length < 6) out.push(k * i);
  }
  return out.join() + " " + out.length;
}
console.log(cut(2, [1, 2, 3]));
console.log(cut(4, [0.5]));
console.log(cut(0, ["x", "y"]), cut(9, [null, 3]));
