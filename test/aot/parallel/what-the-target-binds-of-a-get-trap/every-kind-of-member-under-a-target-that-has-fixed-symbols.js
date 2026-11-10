// A store marks its target with fixed symbols. What the trap may answer is bound by the member under the key alone.
const mark = Symbol("mark");
const lie = { toString: () => "a lie" };
function marked(target) {
  Object.defineProperty(target, mark, { value: target });
  return target;
}
const makers = {
  literal: () =>
    marked({ free: 1, fixed: 2, sealedOff: 3, unread: 4, read: 5, gone: 6 }),
  bare: () =>
    marked(
      Object.assign(Object.create(null), {
        free: 1,
        fixed: 2,
        sealedOff: 3,
        unread: 4,
        read: 5,
        gone: 6,
      }),
    ),
  parsed: () =>
    marked(
      JSON.parse(
        '{"free":1,"fixed":2,"sealedOff":3,"unread":4,"read":5,"gone":6}',
      ),
    ),
  instance: () =>
    marked(
      new (class {
        free = 1;
        fixed = 2;
        sealedOff = 3;
        unread = 4;
        read = 5;
        gone = 6;
      })(),
    ),
};
function fix(target) {
  Object.defineProperty(target, "fixed", {
    writable: false,
    configurable: false,
  });
  Object.defineProperty(target, "sealedOff", { configurable: false });
  Object.defineProperty(target, "unread", { set() {}, configurable: false });
  Object.defineProperty(target, "read", { get: () => 5, configurable: false });
  Object.defineProperty(target, "added", { value: 7 });
  delete target.gone;
  return target;
}
function readAll(proxy) {
  const reads = [
    () => proxy.free,
    () => proxy.fixed,
    () => proxy.sealedOff,
    () => proxy.unread,
    () => proxy.read,
    () => proxy.added,
    () => proxy.gone,
    () => proxy.absent,
    () => proxy[mark] === lie,
  ];
  return reads
    .map((read) => {
      try {
        return String(read());
      } catch (error) {
        return error.constructor.name;
      }
    })
    .join(" ");
}
for (const [kind, make] of Object.entries(makers)) {
  for (const prepare of [(target) => target, fix]) {
    const proxy = new Proxy(prepare(make()), { get: () => lie });
    for (let turn = 0; turn < 3; turn++)
      console.log(kind, prepare === fix ? "fixed" : "as made", readAll(proxy));
  }
}
