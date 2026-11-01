// A function that sets a local to null goes on naming itself and its callers in a stack trace, and its handlers still find what they read.
let made = 0, sum = 0;
function make() { return { id: ++made, payload: [made, made + 1] }; }
function use(thing, more = 0) { sum += (thing ? thing.payload.length : 0) + more; }
const frames = error => error.stack.split("\n").slice(1, 4).map(line => line.trim().replace(/ \(.*/, "").replace(/^at (\/|[A-Za-z]:\\).*/, "at the module")).join(" | ");
function outer(tag) {
  return function inner() {
    let x = make();
    use(x);
    use(x, tag);
    x = null;
    use(null, 1);
    return frames(new Error("e"));
  };
}
class Box {
  constructor(tag) { this.tag = tag; }
  method() {
    let x = make();
    use(x, this.tag);
    use(x);
    x = undefined;
    use(undefined, this.tag);
    return frames(new Error("e")) + " " + this.tag;
  }
}
function caught(flag) {
  const kept = make();
  let x = make();
  try {
    use(x);
    use(x, 1);
    x = null;
    use(null, 2);
    if (flag) throw new Error("thrown");
    return "not thrown " + kept.id;
  } catch (error) {
    return error.message + " " + kept.payload.length + " " + frames(error);
  } finally {
    use(kept);
  }
}
for (const tag of [1, 2, 3]) console.log(outer(tag)(), "/", new Box(tag).method());
console.log(caught(true));
console.log(caught(false).replace(/\d+/, "n"));
console.log(sum);
