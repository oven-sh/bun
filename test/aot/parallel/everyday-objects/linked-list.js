// A list of nodes that is built, reversed and cut
class Node {
  constructor(value, next = null) {
    this.value = value;
    this.next = next;
  }
}
function build(values, drop) {
  let head = null;
  for (const value of values) head = new Node(value, head);
  let reversed = null;
  while (head) [head.next, reversed, head] = [reversed, head, head.next];
  while (reversed && reversed.value === drop) reversed = reversed.next;
  for (let node = reversed; node && node.next; ) {
    if (node.next.value === drop) node.next = node.next.next;
    else node = node.next;
  }
  const out = [];
  for (let node = reversed; node; node = node.next) out.push(node.value);
  return out.join(">") + " " + out.length;
}
console.log(build([1, 2, 3, 2], 2));
console.log(build([5, 5, 5], 5));
console.log(build([7], 1));
