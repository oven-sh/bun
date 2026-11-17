// Objects turned into keys by a text, in an object and in a Map
const keyOf = ({ x, y }) => `${x},${y}`;
function visit(moves) {
  const seen = {};
  const order = new Map();
  let at = { x: 0, y: 0 };
  for (const [dx, dy] of moves) {
    at = { x: at.x + dx, y: at.y + dy };
    const key = keyOf(at);
    seen[key] = (seen[key] ?? 0) + 1;
    if (!order.has(key)) order.set(key, order.size);
  }
  const twice = Object.keys(seen).filter(key => seen[key] > 1);
  return [...order].map(entry => entry.join("#")).join(" ") + " " + twice.join(";") + " " + String({}) + (order.get(at) ?? "none");
}
console.log(visit([[1, 0], [0, 1], [-1, 0], [1, 0]]));
console.log(visit([[5, 5], [-5, -5], [5, 5], [0, 0]]));
console.log(visit([[0, 0]]));
