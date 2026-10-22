function* values() {
  yield 1.5;
  yield "two";
}
const list = Array.from(values());
console.log(list.length, list[0] + 1, list[1].length);
