// Object.keys(o).forEach(f): the callback takes names away from the object and adds others: the list was made before the first call
const hidden = JSON.parse('{"set":"set","remove":"deleteProperty"}');
const reflect: any = Reflect;
const log: string[] = [];
let isArmed = false;
function note(text: string) { log.push(text); }
function subject(o: Record<string, number>) {
  Object.keys(o).forEach((key, index) => {
    note(key + index + ":" + o[key]);
    if (!isArmed) return;
    reflect[hidden.remove](o, "c");
    reflect[hidden.set](o, "late" + index, index);
  });
}
function run(o: Record<string, number>) {
  log.length = 0;
  let answer = "done";
  try { subject(o); } catch (error: any) { answer = error.name + ": " + error.message; }
  let left = "";
  for (const key in o) left += key + " ";
  console.log(answer + " | " + log.join(" ") + " | " + left);
}
run({ a: 1, b: 2, c: 3 });
for (let turn = 0; turn < 3; turn++) run({ a: turn, b: 2, c: 0 });
isArmed = true;
run({ a: 1, b: 2, c: 3 });
isArmed = false;
run({ a: 1, b: 2, c: 3 });
