// The list is a copy of a parameter.
function total(items) {
  const list = Array.from(items);
  let sum = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    sum += list[i];
    for (let j = 0; j < list.length; j++) sum += list[j];
  }
  return sum;
}
console.log(total(JSON.parse("[1,2,3]")));
