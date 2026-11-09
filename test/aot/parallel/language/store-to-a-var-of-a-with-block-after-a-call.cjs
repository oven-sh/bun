// Inside `with`, the declaration `var result = made` asks the object for `result` when it runs: behind the call that gave the object that property. So it stores in the object, as the assignment does, in a function and at the top of the file.
function make(object) {
  object.result = "property";
  return "made";
}
function assign(object) {
  with (object) {
    var result;
    const made = make(object);
    result = made;
  }
  return result;
}
function declare(object) {
  with (object) {
    const made = make(object);
    var result = made;
  }
  return result;
}
const objects = [{}, {}, {}];
console.log(String(assign(objects[0])), objects[0].result);
console.log(String(declare(objects[1])), objects[1].result);
with (objects[2]) {
  const made = make(objects[2]);
  var result = made;
}
console.log(String(result), objects[2].result);
