const box = { held: 1 };
let asked = 0;
const proxy = new Proxy(
  {},
  {
    get(target, name) {
      box.held = box.held * 2;
      asked = asked + 1;
      return asked === 4 ? null : proxy;
    },
    has(target, name) {
      box.held = box.held + 1;
      return asked !== 2;
    },
  },
);
function run(start) {
  let at = start,
    found = 0;
  const before = box.held;
  while (at !== null) {
    if ("x" in at) found = found + 1;
    at = at.next;
  }
  return [before, box.held, asked, found].join();
}
console.log(run(proxy));
