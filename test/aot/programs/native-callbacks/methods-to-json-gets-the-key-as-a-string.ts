// Methods found through instances: JSON.stringify calls toJSON with the key, a string, while every call in the program passes a number.
class Reading {
  constructor(public value: number) {}
  toJSON(scale: number): number {
    return typeof scale === "number" ? this.value * scale : this.value + 1000 + (scale as string).length;
  }
}

const reading = new Reading(7);
let sum = reading.toJSON(2) + reading.toJSON(3);
const text = JSON.stringify({ first: reading, list: [reading, reading] });
for (const part of text.match(/\d+/g)!) sum += Number(part);
console.log(sum);
