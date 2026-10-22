const list = [1, 2, 3];
list.forEach((value, index) => {
  console.log(value, index);
  list.length = 1;
});
