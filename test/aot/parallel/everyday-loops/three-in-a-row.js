// Lines of a board of three by three, the winners pushed
function winners(cells) {
  const lines = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 3, 6, 1, 4, 7, 2, 5, 8, 0, 4, 8, 2, 4, 6];
  const out = [];
  for (let line = 0; line < 8; line++) {
    let sum = 0;
    for (let k = 0; k < 3; k++) {
      sum += cells[lines[line * 3 + k]];
      if (sum === 3 || sum === -3) out.push(line);
    }
    out.push(sum);
  }
  return out.join();
}
console.log(winners([1, 1, 1, 0, -1, 0, -1, 0, 0]));
console.log(winners([1, -1, 1, -1, 1, -1, 1, -1, 1]));
console.log(winners([0, 0, 0, 0, 0, 0, 0, 0, 0]));
