// A store under an index adds no name to an array that a built-in has made. A store under a name does, and what is stored there hides the method above it.
function first() { return "first"; }
function second() { return "second"; }
function always() { return true; }

function filled() {
  const list = new Array(2);
  list[0] = first;
  list[1] = second;
  return list;
}
console.log(filled().find(always)(), filled().length, filled().map(f => f()).join());

function hidden() {
  const list = new Array(2);
  list[0] = first;
  list[1] = second;
  list.find = function () { return second; };
  return list;
}
console.log(hidden().find(always)(), Object.keys(hidden()).join());

function patched() {
  const copy = [1, 2, 3].slice();
  copy[1] = 20;
  copy[5] = 60;
  return copy;
}
console.log(patched().length, patched().indexOf(60), 4 in patched(), patched().filter(x => x > 2).join());

function oddKeys() {
  const list = Object.keys({ a: 1, b: 2 });
  list[-1] = "minus";
  list[1.5] = "half";
  list["map"] = () => "own map";
  return list;
}
console.log(oddKeys().length, Object.keys(oddKeys()).join(), oddKeys().map(x => x));

function shortened() {
  const list = "a,b,c".split(",");
  list.length = 1;
  return list;
}
console.log(shortened().length, shortened()[1], shortened().join());

function grown() {
  const list = [1, 2].concat([3]);
  list.length = 5;
  return list;
}
console.log(grown().length, grown()[4], grown().findIndex(x => x === undefined));

class List extends Array {}
function below() {
  const list = new List(2);
  list[0] = first;
  list[1] = second;
  return list;
}
console.log(below().find(always)(), below() instanceof List, below().map(f => f()) instanceof List, below().length);

function bytes() {
  const view = new Uint8Array(3);
  view[0] = 300;
  view[7] = 1;
  view.extra = "named";
  return view;
}
console.log(bytes()[0], bytes()[7], bytes().length, bytes().extra, Object.keys(bytes()).join(), bytes().map(x => x + 1).join());

function searching() {
  const pattern = new RegExp("a", "g");
  pattern.lastIndex = 1;
  return pattern;
}
console.log(searching().test("aa"), searching().test("ab"), searching().lastIndex, "aXa".replace(searching(), "-"));

function replaced() {
  const pattern = new RegExp("a", "g");
  pattern.lastIndex = 1;
  pattern.exec = function () { return null; };
  return pattern;
}
console.log(replaced().test("aa"), "aa".replace(replaced(), "-"));
