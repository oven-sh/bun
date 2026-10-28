// A helper is given a list and a function and calls the function, which changes the list between two reads of the caller.
function apply(list: any[], change: (list: any[]) => void, times: number) {
  let sum = 0;
  for (let i = 0; i < times; i++) {
    change(list);
    sum += list.length;
  }
  return sum;
}
const shorten = (list: any[]) => {
  list.length = 1;
};
const fraction = (list: any[]) => {
  list[0] = 0.5;
};
const text = (list: any[]) => {
  list[1] = "text";
};
const nothing = (list: any[]) => {};
const hole = (list: any[]) => {
  delete list[0];
};
function run(which: number) {
  const list: any[] = [1, 2, 3];
  let out = "";
  for (let i = 0; i < 3; i++) {
    out += list[0] + "," + list[1] + ";";
    if (which === 0) apply(list, nothing, 1);
    if (which === 1) apply(list, shorten, 1);
    if (which === 2) apply(list, fraction, 1);
    if (which === 3) apply(list, text, 1);
    if (which === 4) apply(list, hole, 1);
    out += list[0] + "," + list[1] + "|";
  }
  return which + ": " + out;
}
const lines = new Set<string>();
for (let turn = 0; turn < 1000; turn++) lines.add(run(turn < 400 ? 0 : turn % 5));
for (const line of lines) console.log(line);
