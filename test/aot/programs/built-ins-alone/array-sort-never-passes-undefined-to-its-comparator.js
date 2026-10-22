const list = [2.5, undefined, 1.5];
list.sort((left, right) => {
  console.log(typeof left, typeof right);
  return left - right;
});
console.log(list[0] + 1, list[2] === undefined);
