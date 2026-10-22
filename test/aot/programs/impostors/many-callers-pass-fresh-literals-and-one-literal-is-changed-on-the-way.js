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

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function append(list) {
  return list.push(4);
}

function span(point) {
  return point.x - point.y;
}

function move(point) {
  point.x = point.x + 1;
  return point.x;
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function honest(round) {
  console.log(round, total([1, 2, 3]), total([]), total([0.5, 0.25]), total(new Array(4, 5, 6)), append([1, 2, 3]), append([]), append(new Array(1, 2)));
  console.log(round, span({ x: 3, y: 1 }), span(new Point(5, 2)), span({ x: 0.5, y: 0.25 }), move({ x: 3, y: 1 }), move(new Point(5, 2)), move({ x: 0.5, y: 0.25 }));
}

honest("before");
attempt("an element becomes a string", () => { const list = [1, 2, 3]; list[1] = "2"; return [total(list), append(list)]; });
attempt("an element becomes a fraction", () => { const list = [1, 2, 3]; list[1] = 2.5; return [total(list), append(list)]; });
attempt("an element is deleted", () => { const list = [1, 2, 3]; delete list[1]; return [total(list), append(list)]; });
attempt("an element far away is stored", () => { const list = [1, 2, 3]; list[6] = 7; return [total(list), append(list)]; });
attempt("the length is cut", () => { const list = [1, 2, 3]; list.length = 1; return [total(list), append(list)]; });
attempt("the length is raised", () => { const list = [1, 2, 3]; list.length = 5; return [total(list), append(list)]; });
attempt("an element becomes a getter", () => { const list = [1, 2, 3]; Object.defineProperty(list, 1, { get: () => (log.push("get 1"), 20) }); return [total(list), append(list)]; });
attempt("the array is frozen", () => { const list = [1, 2, 3]; Object.freeze(list); return [total(list), append(list)]; });
attempt("the array gets its own push", () => { const list = [1, 2, 3]; list.push = () => "its own"; return [total(list), append(list)]; });
attempt("the array loses its prototype", () => { const list = [1, 2, 3]; Object.setPrototypeOf(list, null); return [total(list), append(list)]; });
attempt("the array gets another prototype", () => { const list = [1, 2, 3]; Object.setPrototypeOf(list, { push: () => "another prototype's" }); return [total(list), append(list)]; });
attempt("the variable gets another value", () => { let list = [1, 2, 3]; list = "123"; return [total(list), append(list)]; });
attempt("the variable gets another value in a closure", () => { let list = [1, 2, 3]; (() => { list = { length: 1, 0: "only", push: () => "an object's" }; })(); return [total(list), append(list)]; });

attempt("x becomes a string", () => { const point = { x: 3, y: 1 }; point.x = "3"; return [span(point), move(point)]; });
attempt("x is deleted", () => { const point = { x: 3, y: 1 }; delete point.x; return [span(point), move(point), Object.keys(point)]; });
attempt("x is deleted and stored again", () => { const point = { x: 3, y: 1 }; delete point.x; point.x = 3; return [span(point), move(point), Object.keys(point)]; });
attempt("a member is added", () => { const point = { x: 3, y: 1 }; point.z = 0; return [span(point), move(point), Object.keys(point)]; });
attempt("x becomes a getter", () => { const point = { x: 3, y: 1 }; Object.defineProperty(point, "x", { get: () => (log.push("get x"), 30), set: value => log.push("set x " + value) }); return [span(point), move(point)]; });
attempt("x can no longer be stored to", () => { const point = { x: 3, y: 1 }; Object.defineProperty(point, "x", { writable: false }); return [span(point), move(point)]; });
attempt("the object is frozen", () => { const point = { x: 3, y: 1 }; Object.freeze(point); return [span(point), move(point)]; });
attempt("the object gets another prototype", () => { const point = { y: 1 }; Object.setPrototypeOf(point, { x: 3 }); return [span(point), move(point), Object.keys(point)]; });
attempt("an instance loses a field", () => { const point = new Point(3, 1); delete point.y; return [span(point), move(point)]; });
attempt("an instance gets a string", () => { const point = new Point(3, 1); point.y = "1"; return [span(point), move(point)]; });
attempt("an instance moves to another class", () => { const point = new Point(3, 1); Object.setPrototypeOf(point, class { get y() { return 100; } }.prototype); return [span(point), move(point)]; });

const listChanges = [
  ["a string is stored", list => { list[1] = "2"; }],
  ["an element is deleted", list => { delete list[1]; }],
  ["the length is cut", list => { list.length = 1; }],
  ["it is frozen", list => { Object.freeze(list); }],
  ["it gets its own push", list => { list.push = () => "its own"; }],
  ["it loses its prototype", list => { Object.setPrototypeOf(list, null); }],
  ["nothing", () => {}],
];
const pointChanges = [
  ["a string is stored", point => { point.x = "3"; }],
  ["x is deleted", point => { delete point.x; }],
  ["x becomes a getter", point => { Object.defineProperty(point, "x", { get: () => (log.push("get x"), 30), set() {} }); }],
  ["it is frozen", point => { Object.freeze(point); }],
  ["nothing", () => {}],
];
const hiddenCaller = new Function("change", "value", "change(value)");
for (const [name, change] of listChanges) {
  attempt("a function from a table gets the array: " + name, () => { const list = [1, 2, 3]; change(list); return [total(list), append(list)]; });
  attempt("hidden code gets the array: " + name, () => { const list = [1, 2, 3]; hiddenCaller(change, list); return [total(list), append(list)]; });
  attempt("the array is reached through an object that holds it: " + name, () => { const list = [1, 2, 3]; const box = { list }; change(box.list); return [total(list), append(list)]; });
  attempt("a callback of forEach gets the array: " + name, () => { const list = [1, 2, 3]; [list].forEach(change); return [total(list), append(list)]; });
}
for (const [name, change] of pointChanges) {
  attempt("a function from a table gets the literal: " + name, () => { const point = { x: 3, y: 1 }; change(point); return [span(point), move(point)]; });
  attempt("hidden code gets the literal: " + name, () => { const point = { x: 3, y: 1 }; hiddenCaller(change, point); return [span(point), move(point)]; });
  attempt("a function from a table gets the instance: " + name, () => { const point = new Point(3, 1); change(point); return [span(point), move(point)]; });
  attempt("the constructor leaks the instance: " + name, () => { class Leaky { constructor(x, y) { this.x = x; this.y = y; change(this); } } const point = new Leaky(3, 1); return [span(point), move(point)]; });
}
honest("after");
