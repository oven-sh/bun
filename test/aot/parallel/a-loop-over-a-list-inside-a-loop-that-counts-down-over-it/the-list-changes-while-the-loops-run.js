// The inner loop lays a fraction, then a text, into the list that both loops read.
function total(text, turn, what) {
  const list = Array.from(JSON.parse(text));
  let sum = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    sum += list[i];
    for (let j = 0; j < list.length; j++) {
      if (i === turn && j === 1) list[0] = what;
      sum += list[j];
    }
  }
  return sum;
}
console.log(String(total("[1,2,3,4]", 2, 0.5)), String(total("[1,2,3,4]", 1, "t")), String(total("[1,2,3,4]", 9, 0)));
