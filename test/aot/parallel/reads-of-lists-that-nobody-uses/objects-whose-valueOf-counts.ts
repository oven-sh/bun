let asked = 0;
function turn(weights: any[]): number { let turns = 0; for (let i = 0; i < weights.length; i++) { const twice = weights[i] * 2; turns++; } return turns; }
const hidden = (0, eval)("(x) => x");
const counting = { valueOf() { asked++; return 2; } };
console.log(turn(hidden([1.5, 2.5])), asked);
console.log(turn(hidden([counting, 1.5, counting])), asked);
console.log(turn(hidden([1, 2, 3])), asked);
