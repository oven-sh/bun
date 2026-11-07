const held = {};
held[JSON.parse('"first"')] = depth => 1 + second(depth + 1);
held[JSON.parse('"second"')] = depth => 1 + first(depth + 1);
const first = held[JSON.parse('"first"')];
const second = held[JSON.parse('"second"')];
let answer;
try { answer = String(first(JSON.parse("0"))); } catch (error) { answer = error.constructor.name; }
console.log(answer, typeof first, typeof second);
