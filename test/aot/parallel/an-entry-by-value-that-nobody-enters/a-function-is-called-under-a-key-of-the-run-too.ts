// Functions and methods that are called as written and also out of a record, a list and a map, under keys of the run.
function plus(n: number): number {
  return n + 1;
}
function minus(n: number): number {
  return n - 1;
}
const table: Record<string, (n: number) => number> = { plus, minus };
const list = [plus, minus];
const map = new Map([["plus", plus]]);
const names = ["plus", "minus"];
let sum = plus(1) + minus(1);
for (const name of names) sum += table[name](10);
for (let i = 0; i < list.length; i++) sum += list[i](20);
sum += map.get(names[0])!(30);
console.log(sum);
class Tool {
  spin(n: number): number {
    return n * 2;
  }
  halt(n: number): number {
    return n * 3;
  }
}
const tool: any = new Tool();
let turned = new Tool().spin(1) + new Tool().halt(1);
for (const name of ["spin", "halt"]) turned += tool[name](5);
console.log(turned);
