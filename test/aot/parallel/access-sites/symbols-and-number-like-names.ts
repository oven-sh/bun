// Fields whose names are symbols, array indices, or texts that look like numbers and are not. Each is read and stored under a constant key, on the class that declares it and on look-alikes.
const mark = Symbol("mark");
const shared = Symbol.for("shared");

class Odd {
  [mark] = "mark";
  [shared] = "shared";
  [Symbol.toStringTag] = "OddTag";
  0 = "zero";
  7 = "seven";
  "01" = "leading zero";
  "-1" = "minus one";
  "-0" = "minus zero";
  "1.5" = "fraction";
  "1e3" = "exponent";
  "4294967294" = "largest index";
  "4294967295" = "past the largest index";
  "NaN" = "not a number";
  "Infinity" = "infinity";
  "" = "empty";
  " " = "space";
  "a b" = "with a space";
}

function readAll(value: any): string {
  return [
    value[mark],
    value[shared],
    value[Symbol.toStringTag],
    value[0],
    value["0"],
    value[7],
    value["01"],
    value[-1],
    value["-1"],
    value[-0],
    value["-0"],
    value[1.5],
    value["1.5"],
    value[1e3],
    value["1e3"],
    value[4294967294],
    value["4294967295"],
    value[NaN],
    value[Infinity],
    value[""],
    value[" "],
    value["a b"],
    value["constructor"],
  ]
    .map(each => (typeof each === "function" ? "function" : String(each)))
    .join("|");
}
function readTyped(value: Odd): string {
  return [value[mark], value[shared], value[0], value[7], value["01"], value["-1"], value["1.5"], value["1e3"], value["4294967294"], value["4294967295"], value["NaN"], value[""], value["a b"]].map(String).join("|");
}
function storeTyped(value: Odd, text: string): void {
  value[mark] = text + 1;
  value[shared] = text + 2;
  value[0] = text + 3;
  value[7] = text + 4;
  value["01"] = text + 5;
  value["-1"] = text + 6;
  value["1.5"] = text + 7;
  value["4294967294"] = text + 8;
  value["4294967295"] = text + 9;
  value[""] = text + 10;
}
function keysOf(value: object): string {
  return Reflect.ownKeys(value).map(String).join("|");
}

const odd = new Odd();
console.log(readAll(odd));
console.log(readTyped(odd));
console.log(keysOf(odd));
console.log(String(odd), JSON.stringify(odd));
storeTyped(odd, "s");
console.log(readAll(odd));
console.log(keysOf(odd));

const list: any = ["in a list"];
list[7] = "seventh";
list[mark] = "mark of a list";
list["01"] = "no index";
console.log(readAll(list));
console.log(readTyped(list));
storeTyped(list, "l");
console.log(readTyped(list), list.length);
console.log(keysOf(list).length);

const text: any = "0123456789";
console.log(readAll(text));
console.log(readTyped(text));

const bytes: any = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18]);
console.log(readAll(bytes));
console.log(readTyped(bytes));
storeTyped(bytes, "2");
console.log(readTyped(bytes), keysOf(bytes));

const parsed: any = JSON.parse('{"1.5":"p","7":"q","01":"r","0":"s","-1":"t","":"u"}');
console.log(readAll(parsed));
console.log(readTyped(parsed));
storeTyped(parsed, "p");
console.log(readTyped(parsed));
console.log(keysOf(parsed));
console.log(readTyped(odd));

export {};
