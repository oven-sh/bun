// Two reads of one field of one layout share what they expect and what they learn, and so do two stores. Each of them keeps getting a layout of its own.
class Expected {
  id = 1;
  label = "expected";
}
class Left {
  label = "left";
  id = 2;
}
class Right {
  extra = "x";
  other = 0.25;
  label = "right";
  id = 3;
}

function labelHere(value: Expected): string {
  return value.label;
}
function labelThere(value: Expected): string {
  return value.label;
}
function idHere(value: Expected): number {
  return value.id;
}
function idThere(value: Expected): number {
  return value.id;
}
function renameHere(value: Expected, label: string): void {
  value.label = label;
}
function renameThere(value: Expected, label: string): void {
  value.label = label;
}

const expected = new Expected();
const left = new Left();
const right = new Right();
const parsedLeft: Expected = JSON.parse('{"label":"parsed left","id":4}');
const parsedRight: Expected = JSON.parse('{"a":0,"b":0,"c":0,"id":5,"label":"parsed right"}');

function round(mark: string): void {
  console.log(mark, "layouts:", labelHere(left), labelThere(right), labelHere(left), labelThere(right), idHere(left), idThere(right), idHere(left), idThere(right));
  console.log(mark, "crossed:", labelHere(right), labelThere(left), idHere(right), idThere(left));
  console.log(mark, "parsed:", labelHere(parsedLeft), labelThere(parsedRight), labelHere(parsedLeft), labelThere(parsedRight), idHere(parsedLeft), idThere(parsedRight));
  console.log(mark, "mixed:", labelHere(left), labelThere(parsedRight), labelHere(expected), labelThere(expected), idHere(parsedLeft), idThere(right));
  renameHere(left, "left " + mark);
  renameThere(right, "right " + mark);
  renameHere(parsedLeft, "parsed left " + mark);
  renameThere(parsedRight, "parsed right " + mark);
  renameHere(expected, "expected " + mark);
  console.log(mark, "renamed:", JSON.stringify([expected, left, right, parsedLeft, parsedRight]));
  console.log(mark, "read back:", labelThere(left), labelHere(right), labelThere(parsedLeft), labelHere(parsedRight), labelThere(expected));
}

round("first");
round("second");
round("third");

export {};
