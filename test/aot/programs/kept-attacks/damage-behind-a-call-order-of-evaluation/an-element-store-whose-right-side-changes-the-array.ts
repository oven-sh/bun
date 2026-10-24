// In `list[index] = touch(list)` the array and the index are evaluated first, then the right side runs, then the element is stored. The right side cuts the array, freezes it, changes its kind, or makes the element an accessor.
let mode = 0;
let caught = "";
function touch(list: number[]): number {
  if (mode === 1) list.length = 0;
  else if (mode === 2) Object.freeze(list);
  else if (mode === 3) (list as any)[0] = "s";
  else if (mode === 4) {
    Object.defineProperty(list, 2, {
      get: () => -5,
      set(value: number) {
        caught += value;
      },
    });
  } else if (mode === 5) list.push(1, 2, 3);
  return 9;
}

function holder(list: number[]): string {
  const before = list[2] + list.length;
  let outcome = "stored";
  try {
    list[2] = touch(list);
    list[list.length] = touch(list);
  } catch (error) {
    outcome = (error as Error).name;
  }
  return before + " " + outcome + " " + list.join() + " " + list.length;
}

for (let round = 0; round < 600; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  caught = "";
  const line = holder([round, 1, 2, 3]);
  if (mode || round === 0) console.log(round + ": " + line + " " + caught);
}
