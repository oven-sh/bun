// Under: --aot-check=Validate: the copies of a loop that begin late know the objects made in front
const LATE = JSON.parse("[1,2,3,4,5,6]");
let sum;
function f(src) {
  let fin = 0; const fs = [];
  const list = Array.from(src); sum = 0;
  for (let i = list.length - 1; i >= 0; i--) { sum += list[i]; for (let j = 0; j < list.length; j++) sum += list[j]; fin += LATE[i]; }
  return fs.length + fin;
}
console.log(f(JSON.parse("[1,2,3,4,5]")));
console.log(sum);
