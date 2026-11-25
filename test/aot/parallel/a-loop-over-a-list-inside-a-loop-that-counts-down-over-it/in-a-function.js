// The two loops stand in a function.
function total(text) {
  const list = Array.from(JSON.parse(text));
  let sum = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    sum += list[i];
    for (let j = 0; j < list.length; j++) sum += list[j];
  }
  return sum;
}
console.log(total("[1,2,3]"));
