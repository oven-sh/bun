function turn(weights: number[], cut: () => void): number { let turns = 0; for (let i = 0; i < weights.length; i++) { const twice = weights[i]! * 2; if (i === 1) cut(); turns++; } return turns; }
const hidden = (0, eval)("(x) => x");
const long: number[] = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
console.log(turn(hidden(long), hidden(() => { long.length = 3; })), long.length);
const grown: number[] = [1.5, 2.5];
console.log(turn(hidden(grown), hidden(() => { if (grown.length < 5) grown.push(0.5, "text" as any); })), grown.length);
