function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function forXOf(value, which, text) {
  if (which === 1) return { y: 1, x: 3 };
  if (which === 2) return (0, eval)(text);
  return value;
}

function xOf(value, which, text) {
  return forXOf(value, which, text).x;
}

function forSpan(value, which, text) {
  if (which === 1) return null;
  if (which === 2) return (0, eval)(text);
  return value;
}

function span(value, which, text) {
  const point = forSpan(value, which, text);
  return point.x - point.y;
}

function forUnpacked(value, which, text) {
  if (which === 1) return undefined;
  if (which === 2) return (0, eval)(text);
  return value;
}

function unpacked(value, which, text) {
  const { x, y } = forUnpacked(value, which, text);
  return x * y;
}

function forMoved(value, which, text) {
  if (which === 1) return 5;
  if (which === 2) return (0, eval)(text);
  return value;
}

function moved(value, which, text) {
  const point = forMoved(value, which, text);
  point.x = 9;
  return point.x;
}

function forHasX(value, which, text) {
  if (which === 1) return "xy";
  if (which === 2) return (0, eval)(text);
  return value;
}

function hasX(value, which, text) {
  return "x" in forHasX(value, which, text);
}

function forKeysOf(value, which, text) {
  if (which === 1) return [3, 1];
  if (which === 2) return (0, eval)(text);
  return value;
}

function keysOf(value, which, text) {
  return Object.keys(forKeysOf(value, which, text)).join();
}

function forListed(value, which, text) {
  if (which === 1) return { x: "3", y: "1" };
  if (which === 2) return (0, eval)(text);
  return value;
}

function listed(value, which, text) {
  const names = [];
  for (const name in forListed(value, which, text)) names.push(name);
  return names.join();
}

function forCopied(value, which, text) {
  if (which === 1) return Object.freeze({ x: 3, y: 1 });
  if (which === 2) return (0, eval)(text);
  return value;
}

function copied(value, which, text) {
  return JSON.stringify({ ...forCopied(value, which, text) });
}

function forGrown(value, which, text) {
  if (which === 1) return Object.freeze({ x: 3, y: 1 });
  if (which === 2) return (0, eval)(text);
  return value;
}

function grown(value, which, text) {
  const point = forGrown(value, which, text);
  point.z = 1;
  return Object.keys(point).join();
}

function forShrunk(value, which, text) {
  if (which === 1) return Object.freeze({ x: 3, y: 1 });
  if (which === 2) return (0, eval)(text);
  return value;
}

function shrunk(value, which, text) {
  const point = forShrunk(value, which, text);
  return [delete point.x, "x" in point];
}

function forMaybeX(value, which, text) {
  if (which === 1) return 0;
  if (which === 2) return (0, eval)(text);
  return value;
}

function maybeX(value, which, text) {
  return forMaybeX(value, which, text)?.x;
}

function forBumped(value, which, text) {
  if (which === 1) return { x: 3, get y() { return 1; } };
  if (which === 2) return (0, eval)(text);
  return value;
}

function bumped(value, which, text) {
  const point = forBumped(value, which, text);
  point.y++;
  return point.y;
}

const hidden = [
  "({ y: 1, x: 3 })",
  "({ x: 3 })",
  "null",
  "undefined",
  "5",
  "\"xy\"",
  "[3, 1]",
  "({ x: \"3\", y: \"1\" })",
  "Object.freeze({ x: 3, y: 1 })",
  "Object.create({ x: 3, y: 1 })",
  "({ get x() { return 3; }, get y() { return 1; } })",
  "Object.assign(Object.create(null), { x: 3, y: 1 })",
  "new Proxy({ x: 3, y: 1 }, {})",
  "Object.assign(() => {}, { x: 3, y: 1 })",
];

function honest(round) {
  console.log(round, "xOf", show(xOf({ x: 3, y: 1 })), show(xOf({ x: 0.5, y: 0.25 })), show(xOf(new Point(5, 2))), show(xOf({ x: -1, y: -1 })), show(xOf(new Point(0, 0))));
  console.log(round, "span", show(span({ x: 3, y: 1 })), show(span({ x: 0.5, y: 0.25 })), show(span(new Point(5, 2))), show(span({ x: -1, y: -1 })), show(span(new Point(0, 0))));
  console.log(round, "unpacked", show(unpacked({ x: 3, y: 1 })), show(unpacked({ x: 0.5, y: 0.25 })), show(unpacked(new Point(5, 2))), show(unpacked({ x: -1, y: -1 })), show(unpacked(new Point(0, 0))));
  console.log(round, "moved", show(moved({ x: 3, y: 1 })), show(moved({ x: 0.5, y: 0.25 })), show(moved(new Point(5, 2))), show(moved({ x: -1, y: -1 })), show(moved(new Point(0, 0))));
  console.log(round, "hasX", show(hasX({ x: 3, y: 1 })), show(hasX({ x: 0.5, y: 0.25 })), show(hasX(new Point(5, 2))), show(hasX({ x: -1, y: -1 })), show(hasX(new Point(0, 0))));
  console.log(round, "keysOf", show(keysOf({ x: 3, y: 1 })), show(keysOf({ x: 0.5, y: 0.25 })), show(keysOf(new Point(5, 2))), show(keysOf({ x: -1, y: -1 })), show(keysOf(new Point(0, 0))));
  console.log(round, "listed", show(listed({ x: 3, y: 1 })), show(listed({ x: 0.5, y: 0.25 })), show(listed(new Point(5, 2))), show(listed({ x: -1, y: -1 })), show(listed(new Point(0, 0))));
  console.log(round, "copied", show(copied({ x: 3, y: 1 })), show(copied({ x: 0.5, y: 0.25 })), show(copied(new Point(5, 2))), show(copied({ x: -1, y: -1 })), show(copied(new Point(0, 0))));
  console.log(round, "grown", show(grown({ x: 3, y: 1 })), show(grown({ x: 0.5, y: 0.25 })), show(grown(new Point(5, 2))), show(grown({ x: -1, y: -1 })), show(grown(new Point(0, 0))));
  console.log(round, "shrunk", show(shrunk({ x: 3, y: 1 })), show(shrunk({ x: 0.5, y: 0.25 })), show(shrunk(new Point(5, 2))), show(shrunk({ x: -1, y: -1 })), show(shrunk(new Point(0, 0))));
  console.log(round, "maybeX", show(maybeX({ x: 3, y: 1 })), show(maybeX({ x: 0.5, y: 0.25 })), show(maybeX(new Point(5, 2))), show(maybeX({ x: -1, y: -1 })), show(maybeX(new Point(0, 0))));
  console.log(round, "bumped", show(bumped({ x: 3, y: 1 })), show(bumped({ x: 0.5, y: 0.25 })), show(bumped(new Point(5, 2))), show(bumped({ x: -1, y: -1 })), show(bumped(new Point(0, 0))));
}

honest("before");
attempt("xOf, the other path in sight", () => xOf(undefined, 1));
for (const text of hidden) attempt("xOf of " + text, () => xOf(undefined, 2, text));
attempt("span, the other path in sight", () => span(undefined, 1));
for (const text of hidden) attempt("span of " + text, () => span(undefined, 2, text));
attempt("unpacked, the other path in sight", () => unpacked(undefined, 1));
for (const text of hidden) attempt("unpacked of " + text, () => unpacked(undefined, 2, text));
attempt("moved, the other path in sight", () => moved(undefined, 1));
for (const text of hidden) attempt("moved of " + text, () => moved(undefined, 2, text));
attempt("hasX, the other path in sight", () => hasX(undefined, 1));
for (const text of hidden) attempt("hasX of " + text, () => hasX(undefined, 2, text));
attempt("keysOf, the other path in sight", () => keysOf(undefined, 1));
for (const text of hidden) attempt("keysOf of " + text, () => keysOf(undefined, 2, text));
attempt("listed, the other path in sight", () => listed(undefined, 1));
for (const text of hidden) attempt("listed of " + text, () => listed(undefined, 2, text));
attempt("copied, the other path in sight", () => copied(undefined, 1));
for (const text of hidden) attempt("copied of " + text, () => copied(undefined, 2, text));
attempt("grown, the other path in sight", () => grown(undefined, 1));
for (const text of hidden) attempt("grown of " + text, () => grown(undefined, 2, text));
attempt("shrunk, the other path in sight", () => shrunk(undefined, 1));
for (const text of hidden) attempt("shrunk of " + text, () => shrunk(undefined, 2, text));
attempt("maybeX, the other path in sight", () => maybeX(undefined, 1));
for (const text of hidden) attempt("maybeX of " + text, () => maybeX(undefined, 2, text));
attempt("bumped, the other path in sight", () => bumped(undefined, 1));
for (const text of hidden) attempt("bumped of " + text, () => bumped(undefined, 2, text));
honest("after");
