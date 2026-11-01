// Lists of constants are made in a loop, kept in a list of the same function and read back there at places that are tested first.
// Each evaluation gives a list of its own, and a list that is written later changes alone.
function strings(): string {
  const kept: string[][] = [];
  for (let k = 0; k < 8; k++) kept.push(["x", "y"]);
  let sum = 0;
  for (let i = 0; i < 200; i++) {
    kept[i & 7] = i & 1 ? ["a", "bb"] : ["ccc", "d"];
    const old = kept[(i + 3) & 7]!;
    sum += old[i % 3]?.length ?? 100;
  }
  return sum + " " + (kept[0] === kept[2]) + " " + kept.map(list => list.join("")).join();
}
function integers(): string {
  const kept: number[][] = [];
  for (let k = 0; k < 8; k++) kept.push([7, 8, 9]);
  let sum = 0;
  for (let i = 0; i < 200; i++) {
    kept[i & 7] = i & 1 ? [1, 2, 3] : [4, 5, 6];
    const old = kept[(i + 3) & 7]!;
    sum += old[i & 3] ?? 100;
  }
  return sum + " " + (kept[1] === kept[3]) + " " + kept.join("|");
}
function doubles(): string {
  const kept: number[][] = [];
  for (let k = 0; k < 8; k++) kept.push([0.5, 1.5]);
  let sum = 0;
  for (let i = 0; i < 200; i++) {
    kept[i & 7] = i & 1 ? [1.5, 2.5] : [3.5, -0];
    const old = kept[(i + 3) & 7]!;
    sum += old[i % 3] ?? 100;
  }
  return sum + " " + Object.is(kept[0]![1], -0) + " " + kept.join("|");
}
// The same constants at a second place, whose lists are written.
function written(): string {
  const kept: string[][] = [];
  for (let k = 0; k < 8; k++) kept.push(["x", "y"]);
  let sum = 0;
  for (let i = 0; i < 200; i++) {
    kept[i & 7] = i & 1 ? ["a", "bb"] : ["ccc", "d"];
    const old = kept[(i + 3) & 7]!;
    if (i % 5 === 0) old[0] = "written";
    if (i % 7 === 0) old.push("pushed");
    if (i % 11 === 0) old.length = 1;
    sum += old[i % 3]?.length ?? 100;
  }
  return sum + " " + kept.map(list => list.join("")).join();
}
// Written by code that the compiler does not see.
function writtenByText(): string {
  const kept: number[][] = [];
  const write = new Function("list", "at", "list[at] = 50; return list.length;") as (list: number[], at: number) => number;
  let sum = 0;
  for (let i = 0; i < 40; i++) {
    kept[i & 3] = i & 1 ? [1, 2, 3] : [4, 5, 6];
    const old = kept[(i + 1) & 3];
    if (old && i % 3 === 0) sum += write(old, i & 3);
    sum += old?.[i & 3] ?? 100;
  }
  return sum + " " + kept.join("|");
}
console.log(strings());
console.log(integers());
console.log(doubles());
console.log(written());
console.log(writtenByText());
console.log(strings() === strings(), integers() === integers());
