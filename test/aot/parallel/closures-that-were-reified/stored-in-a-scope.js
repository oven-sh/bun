function make() {
  let last;
  const onRead = (self) => { last = self; return 5; };
  function run(handler) {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    const got = handler(handler);
    return got + work;
  }
  return { onRead, run, kind: () => typeof last };
}
const made = make();
let total = 0, missed = 0;
for (let turn = 0; turn < 300; turn++) {
  try { total += made.run(turn % 50 === 49 ? undefined : made.onRead); }
  catch (error) { missed += error.name === "TypeError" ? 1 : 100; }
}
console.log(total, missed);
console.log(Reflect.ownKeys(made.onRead).length, made.run(made.onRead), made.kind());
