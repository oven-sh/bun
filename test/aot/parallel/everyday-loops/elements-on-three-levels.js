// Three loops, each pushing an element behind the loop inside it
function cubes(list) {
  const out = [];
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      for (let c = 0; c < 2; c++) out.push(list[c]);
      out.push(list[b] * 10);
    }
    out.push(list[a] * 100);
  }
  return out.join();
}
console.log(cubes([1, 2]));
console.log(cubes([50, -50]));
console.log(cubes([3, 4]));
