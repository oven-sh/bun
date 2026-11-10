// slice copies the holes of the list that it reads: each look below tells a hole from a value.
function looks(name: string, copy: (number | undefined)[]) {
  let sum = 0; for (const v of copy) sum += v as number;
  let byIndex = 0; for (let i = 0; i < copy.length; i++) byIndex += copy[i] as number;
  let visited = 0; copy.forEach(() => { visited++; });
  const there: string[] = []; for (let i = 0; i < copy.length; i++) there.push(i in copy ? "value" : "hole");
  console.log(name, copy.length, there.join(" "), Object.keys(copy).join(), visited, sum, byIndex, JSON.stringify(copy), copy.indexOf(undefined), copy.includes(undefined));
}
for (let round = 0; round < 3; round++) {
  const holed = [1, , 3, , 5];
  looks("whole", holed.slice());
  looks("from one", holed.slice(1));
  looks("the middle", holed.slice(1, 4));
  looks("no hole in it", holed.slice(2, 3));
  const made: number[] = new Array(4); made[2] = 7;
  looks("made of a length", made.slice());
  looks("fractions", [0.5, , 2.5].slice());
}
