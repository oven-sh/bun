// A proxy is made and read in one function, and its trap reads through the receiver, which is the proxy: the trap comes to itself again, a few times or until the stack ends.
function deed(depth) {
  let calls = 0;
  const p = new Proxy(
    { x: 1 },
    {
      get(target, key, receiver) {
        calls++;
        return calls < depth ? receiver[key] : "end " + String(key) + " " + calls;
      },
    },
  );
  return p.x;
}
console.log(deed(1), deed(2), deed(5));
function endless() {
  const p = new Proxy({}, { get: (target, key, receiver) => receiver[key] });
  try {
    return p.x;
  } catch (e) {
    return e.name;
  }
}
console.log(endless());
let last = "";
for (let i = 0; i < 300; i++) last = deed(1 + (i % 4));
console.log(last);
