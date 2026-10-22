const list = [1, 2];
list.forEach(value => {
  list.push("text");
  console.log(typeof value);
});
console.log(list.length, list[3].length);
