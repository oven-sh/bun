let asked = 0;
function turn(weights: number[]): number { let turns = 0; for (let i = 0; i < weights.length; i++) { const twice = weights[i]! * 2; turns++; } return turns; }
const hidden = (0, eval)("(x) => x");
console.log(turn(hidden([1.5, 2.5])), asked);
const counting = new Proxy([1.5, 2.5, 3.5], { get(target, key, receiver) { asked++; return Reflect.get(target, key, receiver); } });
console.log(turn(hidden(counting)), asked);
