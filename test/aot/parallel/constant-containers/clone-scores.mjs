const players = ["ann", "bob"].map(name => ({ name, scores: [0, 0] }));
const copy = structuredClone(players);
copy[0].scores[0] = 9;
console.log(`${copy[0].scores[0]} ${copy[1].scores[0]} ${players[0].scores[0]}`);
