// a value that each arm of a row hands to its call, and that the last way returns, with a collection in front of every call
function one(v) { Bun.gc(true); return { x: [v, "one"] }; }
function two(v) { Bun.gc(true); return { y: [v, "two"] }; }
function three(v) { Bun.gc(true); return { z: [v, "three"] }; }
function pick(c, v) { if (c === null) return one(v).x; if (c === undefined) return two(v).y; if (c === true) return three(v).z; return v; }
function deed() {
  const out = [];
  for (const c of [null, undefined, true, 0]) out.push(JSON.stringify(pick(c, { name: "made", of: String(c) })));
  return out.join(" ");
}
console.log(deed());
for (let i = 0; i < 20; i++) deed();
console.log(deed());
