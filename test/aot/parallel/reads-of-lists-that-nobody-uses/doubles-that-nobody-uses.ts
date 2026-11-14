function turn(weights: number[]): number { let turns = 0; for (let i = 0; i < weights.length; i++) { const twice = weights[i]! * 2; turns++; } return turns; }
const hidden = (0, eval)("(x) => x");
console.log(turn(hidden([1.5, 2.5, 3.5])), turn(hidden([])), turn(hidden([0.5])));
