// NaNs that come out of arithmetic on undefined and out of the bytes of a float view are used as positions in arrays, strings and views, are pushed, are tested for their type and are switched on.
const hex = (value: number) =>
  Array.from(new Uint8Array(new Float64Array([value]).buffer), byte => byte.toString(16).padStart(2, "0")).join("");

const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 0xf8, 0xff, 7, 0, 0, 0, 0, 0, 0xf0, 0x7f, 0, 0, 0, 0, 0, 0, 0, 0x40]);
const view = new Float64Array(bytes.buffer);
const sparse: (number | undefined)[] = [1.5, undefined, 2.5];

function describe(value: unknown) {
  switch (value) {
    case 0:
      return "zero";
    case 1:
      return "one";
    case 2:
      return "two";
  }
  return typeof value === "number" ? (value !== value ? "not a number" : "number " + value) : typeof value;
}

function positions(list: number[], text: string, floats: Float64Array, position: number) {
  const named = list as number[] & Record<string, number>;
  console.log(
    "read",
    list[position],
    position in list,
    text[position],
    text.charCodeAt(position),
    text.charAt(position),
    text.at(position),
    text.slice(position, 2),
    text.substring(1, position),
    floats[position],
  );
  list[position] = 7;
  floats[position] = 7;
  console.log("stored", list.length, Object.keys(list).join(), named["NaN"], list[position], floats.join());
  delete named["NaN"];
}

function pushed(value: number) {
  const doubles = [0.5],
    integers = [1],
    anything: unknown[] = ["x"],
    empty: number[] = [];
  doubles.push(value);
  integers.push(value);
  anything.push(value);
  empty.push(value);
  doubles.push(value, 2.5, value);
  console.log(
    "pushed",
    doubles.length,
    doubles.join(),
    integers.join(),
    anything.join(),
    empty.join(),
    hex(doubles[1]!),
    hex(integers[1]!),
    hex(anything[1] as number),
    hex(empty[0]!),
    hex(doubles[4]!),
  );
}

function interpret(code: (number | undefined)[]) {
  const stack: number[] = [];
  let steps = 0;
  for (let pc = 0; steps < 12; steps++) {
    switch (code[pc++]) {
      case 0:
        stack.push(code[pc++]!);
        break;
      case 1:
        stack.push(stack.pop()! + stack.pop()!);
        break;
      case 2:
        pc = code[pc]!;
        break;
      default:
        return `${stack.join()} at ${pc} after ${steps}`;
    }
  }
  return `${stack.join()} still running`;
}

for (let round = 0; round < 3; round++) {
  const outOfUndefined = sparse[round]! * 2,
    outOfBytes = view[round]!,
    computedFromBytes = view[round]! + 1;
  for (const value of [outOfUndefined, outOfBytes, computedFromBytes, -outOfUndefined]) {
    console.log(round, describe(value), describe(value - value), hex(value));
    positions([10, 20, 30], "abc", new Float64Array([1, 2, 3]), value);
    pushed(value);
  }
}
console.log(interpret([0, 1, 0, 2, 1, 3]));
console.log(interpret([0, 1, 1, 3]));
console.log(interpret([0, 4, 2, 9]));
console.log(interpret([0, 4, 2, 4, 0, 5, 1]));
