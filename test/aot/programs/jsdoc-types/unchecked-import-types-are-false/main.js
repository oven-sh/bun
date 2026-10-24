/** @import { Size } from "./shapes" */

/** @param {import("./shapes").Point} p */
function norm(p) {
  return p.x + p.y;
}

/** @param {Size} s */
function area(s) {
  return s.width * s.height;
}

/** @param {import("./shapes").Point[]} points */
function sum(points) {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += points[i].x;
  return total;
}

/** @returns {import("./shapes").Point} */
function make(kind) {
  return kind === 0 ? { x: 1, y: 2 } : kind === 1 ? { x: "1", y: 2 } : kind === 2 ? "text" : null;
}

const getter = {
  get x() {
    return 5;
  },
  y: 6,
};
const values = [{ x: 1, y: 2 }, { x: "1", y: 2 }, { y: 2 }, { x: 1.5, y: -0 }, { x: 1n, y: 2n }, "ab", 7, [3, 4], getter];
for (let round = 0; round < 3; round++) {
  for (const value of values) console.log(String(norm(value)));
}
console.log(area({ width: 2, height: 3 }), area({ width: "2", height: 3 }), area({}), area("ab"));
console.log(sum([{ x: 1 }, { x: 2 }]), sum([{ x: "a" }, { x: 2 }]), sum("ab"), sum({ length: 2, 0: { x: 1 }, 1: { x: 2 } }));
for (let kind = 0; kind < 4; kind++) {
  const made = make(kind);
  console.log(made === null ? "null" : typeof made === "string" ? made.length : made.x + made.y);
}
for (const nothing of [null, undefined]) {
  try {
    norm(nothing);
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
