// a number that goes round a loop minus a negation of what nobody knows, the number on the right
let turns = 0;
let calls = 0;
const text = "four";
function run(a: any, b: any) { let total = 1; for (let i = 0; i < 3; i++) { turns++; total = (-a) - total; } return total; }
const inputs: [unknown, unknown][] = [[2, 3], [2n, 3n], ["4", "2"], [{ valueOf() { calls++; return 5; } }, 2], [{ valueOf() { calls++; return 5n; } }, 2n], [2.5, -1], [-0, 3], [2 ** 31, 2], [2n ** 70n, 1n], [null, 1], [true, 2], [undefined, 2], [2, 3n], ["x", 1]];
for (const [a, b] of inputs) { let said: string; turns = 0; try { const answer = run(a, b); said = typeof answer + " " + String(Object.is(answer, -0) ? "-0" : answer); } catch (error) { said = (error as Error).name; } console.log(said, turns, calls); }
