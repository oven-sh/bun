function work(value) {
  return value + 1;
}
const map = new Map();
map.set("work", work);
map.forEach(each => console.log(each(1.5)));
