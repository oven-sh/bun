export const make = () => ({ n: 1, boom: function named() { return new Error("x").stack.split("\n").slice(0, 2).map(l => l.trim().split(" ").slice(0, 2).join(" ")).join("|"); } });
