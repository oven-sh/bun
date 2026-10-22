// value() is declared to answer a number. It is replaced by functions that hand on what JSON.parse answers, which TypeScript accepts for any type: a text, null, a list, an object, true, a fraction. The caller asks what kind of value it got, adds one to it and turns it into a text.
class Cell {
  value(): number {
    return 1;
  }
}
class Big extends Cell {
  value(): number {
    return 2;
  }
}
class Same extends Cell {}

const kinds = ["number", "string", "object", "boolean", "undefined"];

function look(cell: Cell): number {
  const value = cell.value();
  return kinds.indexOf(typeof value) * 10000 + String(value + 1).length * 100 + String(value).length;
}

function lookAtAll(cells: Cell[]): number {
  let sum = 0;
  for (const cell of cells) sum += look(cell);
  return sum;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const cells: Cell[] = [new Cell(), new Big(), new Same()];
note("numbers", lookAtAll(cells));
for (const text of ['"text"', "null", "[1,2]", '{"a":1}', "true", "2.5", "-0", "1e300"]) {
  Cell.prototype.value = () => JSON.parse(text);
  note("the base method hands on what was parsed", lookAtAll(cells));
}
Big.prototype.value = () => JSON.parse('"another text"');
note("the override too", lookAtAll(cells));

export {};
