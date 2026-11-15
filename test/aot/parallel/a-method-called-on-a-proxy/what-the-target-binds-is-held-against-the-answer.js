// The answer of a get trap is held against a member of the target that can be neither written nor configured, also where the member is read for a call.
const target = {};
Object.defineProperty(target, "fixed", {
  value: () => "fixed",
  writable: false,
  configurable: false,
});
Object.defineProperty(target, "unread", { set() {}, configurable: false });
target.free = () => "free";
let lies = false;
const proxy = new Proxy(target, {
  get(target, name) {
    return lies ? () => "a lie" : target[name];
  },
});
const calls = [
  (holder) => holder.fixed(),
  (holder) => holder.free(),
  (holder) => holder.unread(),
];
for (const now of [false, true, false]) {
  lies = now;
  console.log(
    calls
      .map((call) => {
        try {
          return call(proxy);
        } catch (error) {
          return error.constructor.name;
        }
      })
      .join(" . "),
  );
}
