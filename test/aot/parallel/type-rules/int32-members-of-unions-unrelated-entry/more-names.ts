const circle = { kind: "circle", x: 0.5, radius: 1.5 };
const square = { kind: "square", x: 2.5, side: 3.5, name: "s", w: "w", at: { x: 4.5, name: "n" } };
console.log(circle.x + circle.radius + square.x + square.side + square.at.x);
export {};
