// map passes the holes of its receiver by: they are holes in the result, and the function is not called for them. Each look below tells a hole from a value.
function looks(name: string, copy: (number | undefined)[]) {
  let sum = 0; for (const v of copy) sum += v as number;
  let byIndex = 0; for (let i = 0; i < copy.length; i++) byIndex += copy[i] as number;
  let visited = 0; copy.forEach(() => { visited++; });
  const there: string[] = []; for (let i = 0; i < copy.length; i++) there.push(i in copy ? "value" : "hole");
  console.log(name, copy.length, there.join(" "), Object.keys(copy).join(), visited, sum, byIndex, JSON.stringify(copy), copy.indexOf(undefined), copy.includes(undefined));
}
for (let round = 0; round < 3; round++) {
  let calls = 0;
  const holed = [1, , 3, , 5];
  looks("the same values", holed.map(v => { calls++; return v; }));
  looks("doubled", holed.map(v => (v as number) * 2));
  looks("the places", holed.map((_, i) => i));
  const made: number[] = new Array(3); made[1] = 7;
  looks("made of a length", made.map(v => v + 1));
  looks("no hole in it", [1, 2, 3].map(v => v + 1));
  looks("filter leaves none", holed.filter(() => true));
  console.log(calls);
}
