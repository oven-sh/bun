// Methods found through instances: Math, Date, Number, typed arrays, string and array methods call valueOf without an argument, while every call in the program passes a string.
export {};

let total = 0;

class Length {
  constructor(public meters: number) {}
  valueOf(unit: string): number {
    total += typeof unit === "string" ? unit.length : unit === undefined ? 100 : 10000;
    return unit === "cm" ? this.meters * 100 : this.meters;
  }
}

const length: any = new Length(2);
total += (length as Length).valueOf("cm");
const numbers: number[] = [
  Math.max(length, 1),
  Math.imul(length, 3),
  new Date(length).getTime(),
  Number(length),
  new Uint8Array(3).fill(length)[2],
  "abcdef".charCodeAt(length),
  [5, 6, 7, 8].slice(length).length,
  [5, 6, 7, 8].at(length)!,
  "ab".repeat(length).length,
  new Array(length).length,
  isNaN(length) ? 1 : 0,
  length * 2,
  +length,
];
console.log(total, numbers.join());
