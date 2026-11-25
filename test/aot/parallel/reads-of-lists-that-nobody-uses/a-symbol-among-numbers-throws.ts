function turn(weights: any[]): number { let turns = 0; for (let i = 0; i < weights.length; i++) { const twice = weights[i] * 2; turns++; } return turns; }
const hidden = (0, eval)("(x) => x");
console.log(turn(hidden([1.5, 2.5])));
try { console.log(turn(hidden([1.5, Symbol("odd"), 2.5]))); } catch (error) { console.log((error as Error).constructor.name); }
try { console.log(turn(hidden([1.5, 5n, 2.5]))); } catch (error) { console.log((error as Error).constructor.name); }
