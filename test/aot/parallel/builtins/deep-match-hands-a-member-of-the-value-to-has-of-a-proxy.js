// Bun.deepMatch(subset, value) asks a Proxy around a Set in the subset whether it has each member of the value. has() writes the member that it is handed, and the caller reads it in front of the call and behind it.
function run() {
  const member = { x: 1 };
  const target = Object.assign(new Set(), {
    has(handed) {
      handed.x = 2;
      handed.y = "added";
      return true;
    },
    [Symbol.iterator]() {
      return [][Symbol.iterator]();
    },
  });
  Object.defineProperty(target, "size", { get: () => 1 });
  const before = member.x;
  const matched = Bun.deepMatch(new Proxy(target, {}), new Set([member]));
  return [before, matched, member.x, member.y];
}
for (let turn = 0; turn < 3; turn++) console.log(JSON.stringify(run()));
