// The arguments object is given where a length is read.
function collect(first: number, second: number): IArguments {
  return arguments;
}

function lengthOf(item: { length: number }): number {
  return item.length;
}

console.log("start");
console.log("length", lengthOf(collect(1, 2)));
