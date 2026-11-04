// A list of values of every kind is mapped to a list of boxes. The constructor is called in the loop of map, between the test of the new list's storage and the store into it.
// Flags: --aot-heat=everything-is-hot --aot-verify-each-pass
class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}
const inner = [1, 2];
const values: unknown[] = [7, "seven", undefined, null, true, inner, -0];
const boxes = values.map(value => new Box(value));
console.log(boxes.length, boxes[1].value, boxes[5].value === inner, Object.is(boxes[6].value, -0));
