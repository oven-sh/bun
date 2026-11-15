const seed = Number(process.argv[2] ?? 2);
let held;
function changeHeld() { held.get = function () { return "text" + seed; }; }
function lay(target) {
  const d = { get() { return 1; } };
  const map = { first: d };
  held = d; changeHeld();
  Object.defineProperties(target, map);
  
  return 0;
}
const target = { n: seed }; const subject = target;
const kept = lay(target);
function read(s) { return s.first + 1; }
let said; for (let i = 0; i < 30; i++) said = read(subject);
console.log(said, typeof said, typeof kept, typeof subject.second);
