export function sums(boxes, n) { let sum = 0; for (let i = 0; i < n; i++) sum += boxes[i % boxes.length].sum(i); return sum; }
export function sizes(boxes, n) { let sum = 0; for (let i = 0; i < n; i++) sum += boxes[i % boxes.length].size; return sum; }
export function one(box) { return [box.sum(1), box.size, box.sum(2)].join(" "); }
export function set(box) { box.size = 5; return box.x; }
