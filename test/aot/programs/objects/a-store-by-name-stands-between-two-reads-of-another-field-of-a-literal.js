// node.a = node is a store by name in code that seldom runs. It stands between two reads of node.n, and node is a literal of the loop that calls link().
class Made {}
function callWithList(first, second, node, depth) {
  return link.apply(null, [node, (v) => {}, depth]);
}
function link(node, unused, depth) {
  const chosen = node.n % 2 === 0 ? node : node;
  const pair = [chosen, node];
  pair[0].a = node;
  return { tag: "s." + chosen.n, n: chosen.n + 3, a: null, b: null };
}
let text = ""; let other = null;
for (let i = 0; i < 300; i++) {
  const o0 = { tag: "o0." + i, n: i, a: null, b: null };
  other = i % 3 === 0 ? null : o0;
  try {
    const r1 = callWithList(new Made("c." + o0.n, o0.n + 5, null), { tag: "t." + other.n, n: other.n + 3, a: other, b: null }, o0, 1);
    const r2 = link(o0, (v) => {}, 1);
    text += r1.tag + r2.tag;
  } catch (e) {
    text += e.name.length;
  }
}
console.log(text.length, text.slice(-20));
