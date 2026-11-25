// Index stores that make the list longer inside an inner loop
function marks(size, step) {
  const list = [];
  for (let i = 1; i <= size; i++) {
    for (let k = i; k < size; k += step) {
      if (list[k] === undefined) list[k] = 0;
      list[k] += i;
    }
  }
  let holes = 0;
  for (let i = 0; i < list.length; i++) if (!(i in list)) holes++;
  return list.length + ":" + holes + ":" + list.join();
}
console.log(marks(8, 2));
console.log(marks(6, 5));
console.log(marks(2, 1), marks(12, 7));
