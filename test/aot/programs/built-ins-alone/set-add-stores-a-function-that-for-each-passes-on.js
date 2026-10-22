function work(value) {
  return value + 1;
}
const set = new Set();
set.add(work);
set.forEach(each => console.log(each(1.5)));
