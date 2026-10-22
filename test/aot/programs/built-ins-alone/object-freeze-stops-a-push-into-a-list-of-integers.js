const list = [1, 2, 3];
Object.freeze(list);
try {
  list.push(4);
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(list.length, list[2] + 1);
