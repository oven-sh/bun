// The same store into a list of mixed values, and into lists of whole numbers that take a text, a fraction or an object behind the store.
const parsed = JSON.parse(process.argv[2] ?? "[0.5,1,2,3,2097153,-3]");
parsed.push("text");
function fillBehindCase(list, value) {
  switch (value) {
    case 3:
    case 2097153:
    case -3:
      for (let i = 0; i < list.length; i++) list[i] = value;
      break;
  }
  return list;
}
function show(name, list) {
  let read = "";
  for (let i = 0; i < list.length; i++) read += typeof list[i] + " " + String(list[i]) + ",";
  console.log(name, read, list.join(), JSON.stringify(list));
}
for (let round = 0; round < 3; round++) {
  for (const at of [3, 4, 5]) {
    show("mixed", fillBehindCase(["a", { b: 1 }, 2, null, 0.5], parsed[at]));
    const thenText = fillBehindCase([9, 9, 9, 9, 9].slice(), parsed[at]);
    thenText.push("later");
    show("then a text", thenText);
    const thenFraction = fillBehindCase([9, 9, 9, 9, 9].slice(), parsed[at]);
    thenFraction.push(0.25);
    show("then a fraction", thenFraction);
    const thenObject = fillBehindCase([9, 9, 9, 9, 9].slice(), parsed[at]);
    thenObject[2] = { c: round };
    show("then an object", thenObject);
    show("sorted", fillBehindCase([9, 9, 9, 9, 9].slice(), parsed[at]).concat([1, 5]).sort((a, b) => a - b));
  }
}
