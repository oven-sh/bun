// An object that is made, loses a key and gets it again is listed where it was made.
function subject(i: number) {
  const o = { a: i, b: 1 };
  return Object.keys(o).join() + "|" + Object.values(o).join();
}
function deed(i: number) {
  const o: { a?: number; b: number; c?: number } = { a: i, b: 1 };
  delete o.a;
  const without = Object.keys(o).join() + "|" + Object.values(o).join();
  o.a = i + 1;
  o.c = 3;
  return without + " " + Object.keys(o).join() + "|" + Object.values(o).join() + "|" + Object.entries(o).join(";");
}
console.log(subject(1), deed(1));
let all = "";
for (let i = 0; i < 20; i++) all += subject(i) + " " + deed(i) + " ";
console.log(all);
