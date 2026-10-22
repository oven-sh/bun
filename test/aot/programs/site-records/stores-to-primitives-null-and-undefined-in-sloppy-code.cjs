// In sloppy code a store to a primitive value does nothing and throws nothing; a store to null or undefined throws. The right side runs first.
function Target() {
  this.field = 1;
}

var trail = [];

function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return "throws " + error.constructor.name;
  }
}
function noted(value) {
  trail.push("right side " + value);
  return value;
}
function store(target) {
  target.field = noted(2);
}
function create(target) {
  target.extra = noted(3);
}
function update(target) {
  return (target.field += noted(4));
}
function increment(target) {
  return target.field++;
}
function storeLength(target) {
  target.length = noted(0);
}
function look(mark, target) {
  console.log(mark + ":", attempt(() => store(target)), attempt(() => create(target)), attempt(() => update(target)), attempt(() => increment(target)), attempt(() => storeLength(target)), trail.splice(0).join(";"));
}

look("null first", null);
look("honest", new Target());
look("undefined", undefined);
look("zero", 0);
look("fraction", 0.5);
look("not a number", NaN);
look("true", true);
look("false", false);
look("honest", new Target());
look("empty text", "");
look("text", "text");
look("joined text", ["a", "b"].join("-") + "c".repeat(30));
look("symbol", Symbol("s"));
look("bigint", 5n);
look("large bigint", 2n ** 100n);
look("null", null);
look("honest", new Target());
console.log((5).field, "text".extra, "text".length);
