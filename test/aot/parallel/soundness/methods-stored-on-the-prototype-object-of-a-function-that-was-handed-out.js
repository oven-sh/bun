// A function is handed to code the compiler cannot see, and only then gets its methods through its prototype object.
// The compiler expects those methods at every call, so everything the unseen code does to them has to be noticed.
function Point(x) {
  this.x = x;
}
function Pair(x) {
  this.x = x;
}
function Reader(x) {
  this.x = x;
}
Object.setPrototypeOf(Reader.prototype, Point.prototype);

const unseen = new Function(
  "kinds",
  `
  globalThis.replaceNorm = () => { kinds[0].prototype.norm = function () { return "replaced " + this.x; }; };
  globalThis.removeNorm = () => { delete kinds[0].prototype.norm; };
  globalThis.swapPrototype = () => { kinds[1].prototype = { norm() { return "other prototype " + this.x; } }; };
  globalThis.shadow = o => { o.norm = () => "own " + o.x; };
  globalThis.below = kind => new (class extends kind { norm() { return "below " + super.norm(); } })(9);
  return kinds;
`,
);
const kinds = unseen([Point, Pair, Reader]);

Point.prototype.norm = function () {
  return "point " + this.x;
};
Pair.prototype.norm = function () {
  return "pair " + this.x;
};
Object.defineProperty(Reader.prototype, "size", {
  get() {
    return "size " + this.x;
  },
  configurable: true,
});

function norm(o) {
  return o.norm ? o.norm() : "none " + o.x;
}
function walk(list) {
  const seen = [];
  for (let turn = 0; turn < 40; turn++) for (const o of list) seen.push(norm(o));
  return [...new Set(seen)].join(", ");
}

const list = [new Point(1), new Pair(2), new Reader(3)];
console.log(walk(list), list[2].size);
shadow(list[1]);
console.log(walk(list));
console.log(walk([below(Point), below(Reader)]));
replaceNorm();
console.log(walk(list));
swapPrototype();
console.log(walk([new Pair(4), list[1]]));
removeNorm();
console.log(walk(list), kinds.length);
