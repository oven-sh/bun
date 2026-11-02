// A function returns one of two shapes, and only one of them holds another new object. On the other path that object was never made.
function load(version, reload) {
  const cfg = {};
  if (reload) load(version);
  if (version < 2) cfg.legacy = { version, note: "old" };
  return cfg;
}
console.log(JSON.stringify(load(3)), JSON.stringify(load(1)), JSON.stringify(load(1, true)));

function make(depth, width) {
  if (depth <= 0) return width;
  const made = { k: depth, list: [] };
  for (let i = 0; i < width; i++) made.list.push(make(depth - 1, i));
  if (depth % 2) made.extra = { depth, x: 1 };
  return made;
}
console.log(JSON.stringify(structuredClone(make(2, 1))));

function parse(size, n) {
  return (size - n) % 8 === 0 ? { kind: "found", value: { size, n } } : { kind: "unknown", why: "malformed" };
}
console.log(parse(16, 8).kind, parse(15, 1).value, parse(15, 8).why, JSON.stringify(parse(16, 8).value));

function nested(level) {
  const outer = {};
  if (level > 1) outer.a = { b: { level } };
  if (level > 2) outer.c = { level, d: [level] };
  return outer;
}
console.log(JSON.stringify(nested(1)), JSON.stringify(nested(2)), JSON.stringify(nested(3)));

function twice(flag) {
  const held = { flag };
  const result = {};
  if (flag) result.first = held;
  else result.second = held;
  return result;
}
console.log(JSON.stringify(twice(true)), JSON.stringify(twice(false)));

function sharedObject(flag) {
  const held = { flag };
  const result = { held };
  if (flag) result.extra = { held };
  return result;
}
console.log(JSON.stringify(sharedObject(true)), JSON.stringify(sharedObject(false)));
