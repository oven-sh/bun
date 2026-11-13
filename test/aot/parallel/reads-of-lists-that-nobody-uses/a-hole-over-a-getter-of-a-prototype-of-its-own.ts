let asked = 0;
function turn(weights: number[]): number { let turns = 0; for (let i = 0; i < weights.length; i++) { const twice = weights[i]! * 2; turns++; } return turns; }
const hidden = (0, eval)("(x) => x");
const holed: number[] = [1.5, 2.5, 3.5, 4.5]; delete holed[2];
console.log(turn(hidden(holed)), asked);
const above = Object.create(Array.prototype, { 2: { get() { asked++; return 9.5; }, configurable: true } });
Object.setPrototypeOf(holed, above);
console.log(turn(hidden(holed)), asked);
console.log(turn(hidden(holed)), asked);
