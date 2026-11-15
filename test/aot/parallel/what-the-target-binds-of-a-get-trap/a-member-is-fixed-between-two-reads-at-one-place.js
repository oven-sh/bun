// One place reads one name off one proxy; between the reads the member under the name is fixed, the target frozen, sealed, or the member deleted and defined anew.
const mark = Symbol("mark");
function read(proxy) {
  try {
    return String(proxy.member);
  } catch (error) {
    return error.constructor.name;
  }
}
const steps = {
  fixed: (target) =>
    Object.defineProperty(target, "member", {
      writable: false,
      configurable: false,
    }),
  frozen: (target) => Object.freeze(target),
  sealed: (target) => Object.seal(target),
  closed: (target) => Object.preventExtensions(target),
  anew: (target) => {
    delete target.member;
    Object.defineProperty(target, "member", { value: "anew" });
  },
  withoutGetter: (target) =>
    Object.defineProperty(target, "member", { set() {}, configurable: false }),
};
for (const [name, step] of Object.entries(steps)) {
  for (const make of [
    () => ({ member: "true", other: 1 }),
    () => JSON.parse('{"member":"true","other":1}'),
  ]) {
    const target = make();
    Object.defineProperty(target, mark, { value: 1 });
    const proxy = new Proxy(target, { get: () => "a lie" });
    const line = [name];
    for (let turn = 0; turn < 4; turn++) {
      if (turn === 2) step(target);
      line.push(read(proxy));
    }
    console.log(line.join(" "));
  }
}
