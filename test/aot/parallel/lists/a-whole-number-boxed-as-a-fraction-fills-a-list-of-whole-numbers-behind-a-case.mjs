// The 3 comes out of a list that was parsed with a fraction in it, so it is boxed as a fraction. A `case 3` says what the number is, not how it is boxed.
// Stored into a list of whole numbers it has to be read back as 3 by every reader: a loop, join, JSON.stringify, indexOf, includes.
const parsed = JSON.parse(process.argv[2] ?? "[0.5,1,2,3,4]");
parsed.push("text");
function fillBehindCase(list, value) {
  switch (value) {
    case 3:
      for (let i = 0; i < list.length; i++) list[i] = value;
      break;
  }
  return list;
}
for (let round = 0; round < 3; round++) {
  const list = fillBehindCase([9, 9, 9, 9, 9, 9, 9].slice(), parsed[3]);
  let read = "";
  let sum = 0;
  for (let i = 0; i < list.length; i++) read += list[i] + ",";
  for (let i = 0; i < list.length; i++) sum = (sum * 3 + list[i]) | 0;
  console.log(read, list.join(), JSON.stringify(list), list.indexOf(3), list.includes(3), sum);
}
