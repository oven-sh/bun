// A Set that is added to and deleted from while a loop walks it
function reach(edges, start, limit) {
  const seen = new Set([start]);
  const order = [];
  for (const node of seen) {
    order.push(node);
    for (let i = 0; i < edges.length; i++) {
      if (edges[i][0] === node) seen.add(edges[i][1]);
      if (edges[i][1] === node && edges[i][0] !== start && order.length > limit) seen.delete(edges[i][0]);
    }
  }
  return order.join() + "|" + [...seen].join();
}
console.log(reach([[1, 2], [2, 3], [3, 1], [4, 5]], 1, 9));
console.log(reach([["a", "b"], ["b", "c"], ["c", "b"], ["b", "d"]], "a", 1));
console.log(reach([[0.5, 1], [1, 0.5], [1, 2]], 0.5, 0), reach([], null, 1));
