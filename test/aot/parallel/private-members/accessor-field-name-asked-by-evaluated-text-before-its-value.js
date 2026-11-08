// Text that is evaluated in the initializer of a field asks `#name in this` for an `accessor` field that has no value yet: true, as compiled code answers. The getter and the setter are on the object before its first field.
const lines = [];
class Early {
  before = [eval("#gauge in this"), #gauge in this];
  accessor #gauge = 1;
  after = [eval("#gauge in this"), #gauge in this];
}
const early = new Early();
lines.push("before the value: " + JSON.stringify(early.before));
lines.push("after the value: " + JSON.stringify(early.after));
console.log(lines.join("\n"));
