// Shortest paths between four places, all pairs, changes counted
function distances(roads) {
  const d = roads.slice();
  const changes = [];
  for (let via = 0; via < 4; via++) {
    let count = 0;
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        const way = d[a * 4 + via] + d[via * 4 + b];
        if (way < d[a * 4 + b]) {
          d[a * 4 + b] = way;
          changes.push(a * 10 + b);
          count++;
        }
      }
    }
    changes.push(-count);
  }
  return d.join() + " ; " + changes.join();
}
console.log(distances([0, 5, 99, 10, 99, 0, 3, 99, 99, 99, 0, 1, 99, 99, 99, 0]));
console.log(distances([0, 1, 2, 3, 4, 0, 1, 9, 9, 1, 0, 1, 1, 9, 9, 0]));
console.log(distances(new Array(16).fill(7)));
