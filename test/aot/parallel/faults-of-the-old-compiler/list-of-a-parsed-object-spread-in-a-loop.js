// A loop spreads a list that it reads out of a parsed object each turn.
const config = JSON.parse(process.argv[2] ?? '{"items":[1,2]}');
let last = [];
for (let i = 0; i < 2; i++) last = [...config.items];
console.log(last.join());
