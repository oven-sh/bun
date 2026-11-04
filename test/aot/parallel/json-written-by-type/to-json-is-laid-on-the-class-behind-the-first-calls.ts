// toJSON is laid on the prototype object of the class of a row, behind calls that have written rows of the class member by member
// COUNT: operation:operationAOTStringBuilderBegin >= 1
class Row {
  id: number;
  name: string;
  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }
}
function write(row: Row): string {
  return JSON.stringify(row);
}
function deed() {
  (Row.prototype as any).toJSON = function (this: Row) {
    return "row " + this.id;
  };
}
console.log(write(new Row(1, "a")));
for (let i = 0; i < 3; i++) console.log(write(new Row(i, "n" + i)));
deed();
console.log(write(new Row(1, "a")));
for (let i = 0; i < 3; i++) console.log(write(new Row(i, "n" + i)));
delete (Row.prototype as any).toJSON;
console.log(write(new Row(2, "b")));
