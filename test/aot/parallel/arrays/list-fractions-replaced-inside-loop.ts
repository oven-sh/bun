// Loops read a variable declared as a list of numbers. It starts as a list of fractions and takes, inside the loop, a Date and a list of lists that arrive under a cast.
// Flags: --aot-validate
function text(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value)) return "[" + value.map(text).join(",") + "]";
  return String(value);
}
const lines: string[] = [];
function note(value: unknown): void {
  lines.push(text(value));
}

const last = (value: number[]): void => {
  let held: number[] = [2.5, 2.5];
  for (let turn = 0; turn < 4; turn++) {
    note(held.length > 0 ? held[held.length - 1] : 0);
    if (turn === 0) held = value;
  }
};
const each = (value: number[]): void => {
  let held: number[] = [2.5, -0, NaN, 4.5, 5.5, 6.5];
  for (let index = 0; index < 6; index++) {
    note(held[index]);
    if (index === 1) held = value;
  }
};
const sum = (value: number[]): void => {
  let held: number[] = [2.5, 3.5];
  for (let turn = 0; turn < 3; turn++) {
    let total = 0;
    for (let index = 0; index < held.length; index++) total += held[index];
    note(total);
    note(held.length);
    if (turn === 0) held = value;
  }
};
const walk = (value: number[]): void => {
  let held: number[] = [2.5, 3.5];
  for (let turn = 0; turn < 3; turn++) {
    let total = 1;
    for (const element of held) total = total / element;
    note(total);
    if (turn === 0) held = value;
  }
};
const back = (value: number[]): void => {
  const first: number[] = [2.5, -0];
  let held: number[] = first;
  for (let turn = 0; turn < 6; turn++) {
    note(1 / held[1]);
    note(held[0] + held[1]);
    held = turn % 2 === 0 ? value : first;
  }
};
const beyond = (value: number[]): void => {
  let held: number[] = [2.5, 3.5];
  for (let index = -1; index < 5; index++) {
    note(held[index]);
    note(index in held);
    if (index === 0) held = value;
  }
};

function print(title: string): void {
  console.log(title, lines.join(" "));
  lines.length = 0;
}
last(new Date(0) as any);
print("last");
last([[1], [2]] as any);
print("last");
each(new Date(0) as any);
print("each");
each([[1], [2]] as any);
print("each");
sum(new Date(0) as any);
print("sum");
sum([[1], [2]] as any);
print("sum");
back(new Date(0) as any);
print("back");
back([[1], [2]] as any);
print("back");
beyond(new Date(0) as any);
print("beyond");
beyond([[1], [2]] as any);
print("beyond");
try {
  walk(new Date(0) as any);
} catch (error) {
  note((error as Error).name);
}
print("walk");
walk([[1], [2]] as any);
print("walk");
