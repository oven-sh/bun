// A queue that is pushed to and shifted from, level by level
function levels(children, root) {
  const queue = [root];
  const out = [];
  while (queue.length) {
    const level = [];
    for (let n = queue.length; n > 0; n--) {
      const node = queue.shift();
      level.push(node);
      const list = children[node];
      if (list) for (let i = 0; i < list.length; i++) if (out.length < 6) queue.push(list[i]);
    }
    out.push(level.join("+"));
  }
  return out.join(" > ");
}
console.log(levels({ a: ["b", "c"], b: ["d"], c: ["e", "f"] }, "a"));
console.log(levels({ 1: [2, 3], 2: [1], 3: [4] }, 1));
console.log(levels({}, null), levels([[1, 2], [2], [0.5]], 0));
