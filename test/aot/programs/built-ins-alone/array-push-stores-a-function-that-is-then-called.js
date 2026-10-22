function work(value) {
  return value + 1;
}
const list = [];
list.push(work);
console.log(list[0](1.5));
