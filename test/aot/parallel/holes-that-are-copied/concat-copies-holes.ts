// concat copies the holes of the receiver and of every list that it spreads: each look below tells a hole from a value.
function looks(name: string, copy: (number | undefined)[]) {
  let sum = 0; for (const v of copy) sum += v as number;
  let byIndex = 0; for (let i = 0; i < copy.length; i++) byIndex += copy[i] as number;
  let visited = 0; copy.forEach(() => { visited++; });
  const there: string[] = []; for (let i = 0; i < copy.length; i++) there.push(i in copy ? "value" : "hole");
  console.log(name, copy.length, there.join(" "), Object.keys(copy).join(), visited, sum, byIndex, JSON.stringify(copy), copy.indexOf(undefined), copy.includes(undefined));
}
for (let round = 0; round < 3; round++) {
  const holed = [1, , 3];
  looks("nothing added", holed.concat());
  looks("a list without holes added", holed.concat([4, 5]));
  looks("added to a list without holes", [4, 5].concat(holed as number[]));
  looks("two lists with holes", holed.concat([6, , 8], holed));
  looks("three lists and a value", [0].concat(holed as number[], [, 9] as number[], holed as number[], 10));
  const made: number[] = new Array(2);
  looks("made of a length", made.concat(made));
}
