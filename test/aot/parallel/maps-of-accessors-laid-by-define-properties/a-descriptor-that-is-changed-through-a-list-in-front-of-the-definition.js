const seed = Number(process.argv[2] ?? 2);
function changeFirst(list) { list[0].get = function () { return "text" + seed; }; }
function lay(target) {
  const d = { get() { return 1; } };
  const map = { first: d };
  const list = [d]; changeFirst(list);
  Object.defineProperties(target, map);
  
  return 0;
}
const target = { n: seed }; const subject = target;
const kept = lay(target);
function read(s) { return s.first + 1; }
let said; for (let i = 0; i < 30; i++) said = read(subject);
console.log(said, typeof said, typeof kept, typeof subject.second);
