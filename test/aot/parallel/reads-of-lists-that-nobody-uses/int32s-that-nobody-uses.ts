function turn(weights: number[]): number { let turns = 0; for (let i = 0; i < weights.length; i++) { const twice = weights[i]! * 2; turns++; } return turns; }
const hidden = (0, eval)("(x) => x");
console.log(turn(hidden([1, 2, 3, 4])), turn(hidden([7])));
