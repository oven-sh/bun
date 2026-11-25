let asked = 0;
function turn(weights: number[]): number { let turns = 0; for (let i = 0; i < weights.length; i++) { const twice = weights[i]! * 2; turns++; } return turns; }
const hidden = (0, eval)("(x) => x");
const watched: number[] = [1.5, 2.5, 3.5, 4.5];
console.log(turn(hidden(watched)), asked);
Object.defineProperty(watched, 2, { get() { asked++; return 9.5; }, configurable: true });
console.log(turn(hidden(watched)), asked);
console.log(turn(hidden(watched)), asked);
