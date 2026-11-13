// Labeled break and continue out of three loops, lists pushed at each level
function search(cube, wanted) {
  const path = [];
  outer: for (let z = 0; z < cube.length; z++) {
    path.push("z" + z);
    rows: for (let y = 0; y < cube[z].length; y++) {
      path.push("y" + y);
      for (let x = 0; x < cube[z][y].length; x++) {
        path.push(cube[z][y][x]);
        if (cube[z][y][x] === wanted) break outer;
        if (cube[z][y][x] === null) continue rows;
        if (cube[z][y][x] === undefined) continue outer;
      }
    }
  }
  return path.join(" ");
}
const cube = [[[1, 2], [3, null, 9]], [[undefined, 5], [6]], [["a", "b"]]];
console.log(search(cube, 9));
console.log(search(cube, 6));
console.log(search(cube, "b"), search([], 1));
