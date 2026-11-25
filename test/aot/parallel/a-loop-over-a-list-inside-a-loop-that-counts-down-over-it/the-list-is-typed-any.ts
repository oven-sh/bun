// The list is typed any[].
const list: any[] = Array.from(JSON.parse("[1,2,3]"));
let sum = 0;
for (let i = list.length - 1; i >= 0; i--) {
  sum += list[i];
  for (let j = 0; j < list.length; j++) sum += list[j];
}
console.log(sum);
