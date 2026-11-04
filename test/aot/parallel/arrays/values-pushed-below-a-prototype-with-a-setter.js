// a list is laid below an object that has a setter on an index, through a function that the build cannot name: of three values pushed the middle one goes to the setter
const hidden = JSON.parse('{"lay":"setPrototypeOf"}');
const box = JSON.parse('{"list":[1]}');
const seen = [];
function pushedThree(list, first, second, third) {
  const length = list.push(first, second, third);
  return String(length);
}
function deed(list) {
  Reflect[hidden.lay](list, Object.create(Array.prototype, { 8: { set(value) { seen.push("set " + value); } } }));
}
console.log(pushedThree(box.list, 2, 3, 4));
console.log(pushedThree(box.list, 5, 6, 7));
deed(box.list);
console.log(pushedThree(box.list, "a", "b", "c"));
console.log(seen.join());
console.log(Object.keys(box.list).join());
console.log(String(box.list.length) + " " + String(box.list[8]));
console.log(pushedThree(box.list, "d", "e", "f"));
console.log(box.list.join());
