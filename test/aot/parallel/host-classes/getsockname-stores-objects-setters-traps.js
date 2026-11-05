// listener.getsockname(out) stores the address into `out`: setters and proxy traps of `out` run.
// Flags: --aot-validate
const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });

function countCalls(makeOut) {
  let calls = 0;
  const out = makeOut(() => calls++);
  const before = calls;
  listener.getsockname(out);
  return `${before} ${calls}`;
}

console.log(
  "set trap",
  countCalls(
    count =>
      new Proxy(
        {},
        {
          set(target, key, value) {
            count();
            return Reflect.set(target, key, value);
          },
        },
      ),
  ),
);
console.log(
  "defineProperty trap",
  countCalls(
    count =>
      new Proxy(
        {},
        {
          defineProperty(target, key, descriptor) {
            count();
            return Reflect.defineProperty(target, key, descriptor);
          },
        },
      ),
  ),
);
console.log(
  "own setter",
  countCalls(count => ({
    set port(value) {
      count();
    },
  })),
);
console.log(
  "inherited setter",
  countCalls(count =>
    Object.create({
      set address(value) {
        count();
      },
    }),
  ),
);

const plain = {};
listener.getsockname(plain);
console.log(Object.keys(plain).sort().join(), plain.address, plain.family, plain.port === listener.port);
listener.stop(true);
