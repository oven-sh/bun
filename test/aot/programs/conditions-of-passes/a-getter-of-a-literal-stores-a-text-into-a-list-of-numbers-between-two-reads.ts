// Between two reads of a list of numbers stands the read of a getter that lies in a literal. At its fiftieth call the getter stores a text into the list.
const list: number[] = [1.5, 2.5, 3.5];
const holder = {
  hits: 0,
  get convert(): number {
    this.hits++;
    if (this.hits === 50) (list as unknown[])[0] = "text";
    return 0;
  },
};
function read(h: typeof holder, l: number[]): number {
  const a = l[1];
  const g = h.convert;
  const b = l[2];
  return a + g + b;
}
let sum = 0;
for (let round = 0; round < 80; round++) sum += read(holder, list);
console.log(sum, list.join());
