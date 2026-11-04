// A proxy is made and read in one function, and between two reads its handler gets another trap, loses the trap, and gets one that cannot be called.
function deed(v, how) {
  const handler = {
    get(target, key) {
      return "first " + String(key);
    },
  };
  const p = new Proxy({ x: v }, handler);
  const before = p.x;
  if (how === 0) handler.get = () => "second";
  if (how === 1) delete handler.get;
  if (how === 2) handler.get = 5;
  if (how === 3) Object.setPrototypeOf(handler, { get: () => "never" });
  if (how === 4) {
    delete handler.get;
    Object.setPrototypeOf(handler, { get: () => "above" });
  }
  try {
    return before + " | " + String(p.x) + " | " + String(p["y"]);
  } catch (e) {
    return before + " | " + e.name;
  }
}
for (let how = 0; how < 6; how++) console.log(how, deed(1, how));
let last = "";
for (let i = 0; i < 300; i++) last = deed(i, i % 6);
console.log(last);
