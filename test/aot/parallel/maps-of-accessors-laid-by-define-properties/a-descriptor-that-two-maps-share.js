const seed = Number(process.argv[2] ?? 2);

function lay(target) {
  const d = { get() { return 1; } };
  const map = { first: d };
  const other = { second: d }; Object.defineProperties(target, other);
  Object.defineProperties(target, map);
  
  return 0;
}
const target = { n: seed }; const subject = target;
const kept = lay(target);
function read(s) { return s.first === undefined ? "nothing" : s.first.toString().length; }
let said; for (let i = 0; i < 30; i++) said = read(subject);
console.log(said, typeof said, typeof kept, typeof subject.second);
