// A loop reads and replaces a static field of a class, and its last turn deletes the field.
const n = Number(process.argv[2] ?? 2);
class S { static k = { n: 64 }; }
function run(count) {
  let t = 0;
  for (let i = 0; i < count; i++) {
    S.k = { n: S.k.n / 2 };
    t += S.k.n;
    if (i === 1) delete S.k;
  }
  return t;
}
console.log(run(n));
