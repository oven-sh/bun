// One function meets whole numbers, fractions, a text in the middle, a hole, and an empty list.
function total(text) {
  const list = Array.from(JSON.parse(text));
  let sum = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    sum += list[i];
    for (let j = 0; j < list.length; j++) sum += list[j];
  }
  return sum;
}
for (const text of ["[1,2,3]", "[1.5,2,3.25]", '[1,"x",3]', "[]", "[7]", "[1,null,3]", '["a","b"]', "[1,2,3,4,5,6,7,8,9]"])
  console.log(text, String(total(text)));
