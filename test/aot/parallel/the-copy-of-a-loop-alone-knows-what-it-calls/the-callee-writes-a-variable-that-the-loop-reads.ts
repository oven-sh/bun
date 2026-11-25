let limit = 10;
function count(step: () => void): number { let turns = 0; for (let i = 0; i < limit; i++) { step(); turns++; } return turns; }
function main() { console.log(count(() => { limit -= 1; }), limit, count(() => { if (limit < 8) limit += 1; }), limit, count(() => {})); }
main();
