// A list of which nothing is known and that begins with an object is written by one call into the run time, not by one for each element.
// COUNT: operation:operationAOTStringBuilderAppendJSON <= 20
const given = JSON.parse(process.argv[2] ?? '[{"a":1,"b":[1,2]},{"a":2},{"a":3},{"a":4},{"a":5},{"a":6},{"a":7},{"a":8},{"a":9},{"a":10}]');
function make(keys, values) {
  return { k: keys, v: values };
}
let length = 0;
for (let round = 0; round < 20; round++) {
  const keys = [];
  const values = [];
  for (const one of given) {
    keys.push("key" + one.a);
    values.push(one);
  }
  const text = JSON.stringify(make(keys, values));
  length += text.length;
  if (round === 0) console.log(text);
}
console.log(length);
