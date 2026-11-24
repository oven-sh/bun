// What splice takes out keeps its holes, and so does what it leaves behind: each look below tells a hole from a value.
function looks(name: string, copy: (number | undefined)[]) {
  let sum = 0; for (const v of copy) sum += v as number;
  let byIndex = 0; for (let i = 0; i < copy.length; i++) byIndex += copy[i] as number;
  let visited = 0; copy.forEach(() => { visited++; });
  const there: string[] = []; for (let i = 0; i < copy.length; i++) there.push(i in copy ? "value" : "hole");
  console.log(name, copy.length, there.join(" "), Object.keys(copy).join(), visited, sum, byIndex, JSON.stringify(copy), copy.indexOf(undefined), copy.includes(undefined));
}
for (let round = 0; round < 3; round++) {
  let holed = [1, , 3, , 5];
  looks("all taken out", holed.splice(0));
  looks("what is left", holed);
  holed = [1, , 3, , 5];
  looks("the middle taken out", holed.splice(1, 3));
  looks("what is left", holed);
  holed = [1, , 3, , 5];
  looks("one hole taken out, two values put in", holed.splice(1, 1, 8, 9));
  looks("what is left", holed);
  holed = [1, , 3, , 5];
  looks("nothing taken out", holed.splice(2, 0));
  looks("what is left", holed);
}
