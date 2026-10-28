// `parse` holds JSON.parse, or String if the text is long. The call in the loop goes through the variable.
const text = '{"id":7}';
let parse = JSON.parse;
if (text.length > 1000) parse = String;
function read(turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    const row = parse(text);
    sum = (sum + row.id) | 0;
  }
  return sum;
}
console.log(read(10));
