// A function too large to be copied calls itself twice. Its head asks a field and returns what is kept there. The head is copied in front of each call of itself as in front of any other call: where the answer is kept, no call is made.
function make(depth, seed) {
  const node = { done: depth === 0, size: seed % 17, weight: (seed * 7) % 13, left: null, right: null };
  if (depth > 0) { node.left = make(depth - 1, seed * 2 + 1); node.right = make(depth - 1, seed * 3 + 2); }
  return node;
}
let visits = 0;
function measure(node, level) {
  if (node.done) return node.size;
  visits++;
  let sum = node.size * 3 + node.weight;
  sum = (sum * 31 + level) % 1009;
  sum = (sum ^ (sum >> 3)) + node.size;
  sum = (sum * 17 + node.weight * level) % 2003;
  sum = (sum ^ (sum >> 5)) + level * 2;
  sum = (sum * 13 + node.size * node.weight) % 4001;
  sum = (sum ^ (sum >> 2)) + node.weight;
  sum = (sum * 11 + level * level) % 8009;
  sum = (sum ^ (sum >> 7)) + node.size * 5;
  sum = (sum * 7 + node.weight * 3) % 16001;
  const whole = (sum + measure(node.left, level + 1) * 3 + measure(node.right, level + 1) * 5) % 1000003;
  node.size = whole;
  node.done = true;
  return whole;
}
const tree = make(12, 1);
console.log(measure(tree, 0), visits);
console.log(measure(tree, 0), visits);
console.log(measure(make(3, 5), 2), visits);
let asked = 0;
const counting = { get done() { asked++; return asked > 1; }, size: 4, weight: 1, left: { done: true, size: 2 }, right: { get done() { asked += 10; return true; }, get size() { asked += 100; return 3; } } };
try { console.log(measure(counting, 0), asked, visits); } catch (error) { console.log(error instanceof TypeError, asked, visits); }
try { measure({ done: false, size: 1, weight: 1, left: null, right: null }, 0); } catch (error) { console.log(error instanceof TypeError, visits); }
try { measure({ done: false, size: 1, weight: 1, left: { done: 1, size: "text" }, right: { done: "", size: 1, weight: 1, left: { done: {}, size: 1n }, right: { done: true, size: 0 } } }, 0); } catch (error) { console.log(error instanceof TypeError, visits); }
console.log(measure({ done: false, size: 1, weight: 1, left: { done: 1, size: "7" }, right: { done: -0, size: 1, weight: 1, left: { done: [], size: 2.5 }, right: { done: true, size: -0 } } }, 0), visits);
