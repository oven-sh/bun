// The records come out of JSON texts. A loop compares its counter with a member that is a number, a text of digits, or not there, behind a test of the kind.
function mix(sum, next) {
  return (sum * 31 + next * 8) | 0;
}
function work(text, n) {
  const r = JSON.parse(text);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (r.kind === 0 && j < r.limit) sum = mix(sum, j);
    else sum += 1;
  }
  return sum;
}
const texts = ['{"kind":0,"limit":20}', '{"kind":0,"limit":"7"}', '{"kind":1}', '{"kind":0,"limit":12.5}', '{"kind":0}', '{"kind":0,"limit":null}', '{"kind":0,"limit":[9]}'];
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(texts[i % texts.length], 24));
console.log(total);
