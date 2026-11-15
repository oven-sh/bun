// Compiled code deletes the key 4294967295 by the number, one past the greatest index and so a name, and adds another key: the new key comes last.
const made = { a: 1, 4294967295: 2, x: 3 };
function run(o, gone, added) {
  const answer = delete o[gone];
  o[added] = 5;
  return answer;
}
console.log(run(made, JSON.parse("4294967295"), JSON.parse('"w"')), Object.keys(made).join());
