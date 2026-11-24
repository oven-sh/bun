const list = [1, 2, 3, 4, 5];
function sum() {
  let s = 0;
  for (let i = 0; i < list.length; i++) s += list[i];
  return s;
}
function each() {
  let t = "";
  list.forEach((v, i) => {
    t += i + "" + v;
  });
  for (const v of list) t += v;
  return t;
}
console.log(sum(), each());
delete list[2];
console.log(sum(), each());
list[2] = 2.5;
list[7] = "t";
console.log(sum(), each(), list.length);
list.length = 2;
list.push(-0);
Object.freeze(list);
console.log(Object.is(sum(), 3), each());
