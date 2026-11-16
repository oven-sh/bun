// Code made at run time deletes the key 4294967295 by the number off an object that compiled code made: the engine's own road of indices.
const made = { a: 1, 4294967295: 2, x: 3 };
const run = new Function("o", "gone", "added", "const answer = delete o[gone]; o[added] = 5; return answer;");
console.log(run(made, JSON.parse("4294967295"), JSON.parse('"w"')), Object.keys(made).join());
