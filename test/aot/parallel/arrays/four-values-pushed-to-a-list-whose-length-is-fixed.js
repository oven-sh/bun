// the length of a list is made read-only through a function that the build cannot name: a push of four values throws at the first and the list stays as it was
// COUNT: operation:operationAOTArrayPushFour >= 2
const hidden = JSON.parse('{"define":"defineProperty"}');
const box = JSON.parse('{"list":[1,2]}');
function pushedFour(list, first, second, third, fourth) {
  const length = list.push(first, second, third, fourth);
  return String(length);
}
function deed(list) {
  Reflect[hidden.define](list, "length", { writable: false });
}
console.log(pushedFour(box.list, 3, 4, 5, 6));
console.log(pushedFour(box.list, "a", null, undefined, box.list));
console.log(String(box.list[9] === box.list));
box.list.length = 3;
deed(box.list);
try {
  console.log(pushedFour(box.list, 7, 8, 9, 10));
} catch (error) {
  console.log(error.name);
}
console.log(String(box.list.length) + " " + box.list.join() + " " + Object.keys(box.list).join());
