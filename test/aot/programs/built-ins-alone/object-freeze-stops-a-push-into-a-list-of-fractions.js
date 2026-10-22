const list = [1.5, 2.5, 3.5];
Object.freeze(list);
try {
  list.push(4);
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(list.length, list[2] + 1);
