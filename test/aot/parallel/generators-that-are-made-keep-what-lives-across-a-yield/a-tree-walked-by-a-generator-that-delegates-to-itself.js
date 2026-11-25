function grow(low, high) { if (low > high) return null; const middle = (low + high) >> 1; return { left: grow(low, middle - 1), value: middle, right: grow(middle + 1, high) }; }
function* inOrder(node) { if (node === null) return; yield* inOrder(node.left); yield node.value; yield* inOrder(node.right); }
function run(n) { const tree = grow(0, 1022); let total = 0; for (let round = 0; round < n; round += 1023) for (const value of inOrder(tree)) total += value; return total; }
console.log(run(4092));
