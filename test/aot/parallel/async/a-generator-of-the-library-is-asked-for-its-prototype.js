// A generator function of Bun's own library has no `prototype`, so its generators inherit from %GeneratorPrototype% itself. They are asked what they inherit from, and they are there, begun
// and finished, when the first prototype object of a generator function of the program is changed.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6));
const generatorPrototype = Object.getPrototypeOf(function* () {}).prototype;
const out = [];
const describe = (what, g) => out.push(what + ": " + [Object.getPrototypeOf(g) === generatorPrototype, typeof g.next, Object.prototype.toString.call(g), g.extra]);
const scan = () => hide(new Bun.Glob("*.there-is-no-such-file").scanSync({ cwd: import.meta.dir }));
const flags = () => hide(process.allowedNodeEnvironmentFlags.values());
const fresh = scan(), begun = flags(), finished = scan(), never = flags();
begun.next();
out.push("finished: " + JSON.stringify([...finished]));
describe("asked before the change, fresh", scan());
describe("asked before the change, begun", begun);
function make(tag) {
  return hide(function* () {
    yield tag;
  });
}
const mine = make("mine"), kept = hide(mine());
mine.prototype.extra = "added";
out.push("the program's own: " + [kept.extra, kept.next().value, Object.getPrototypeOf(kept) === mine.prototype]);
describe("behind the change, fresh", fresh);
describe("behind the change, begun", begun);
describe("behind the change, finished", finished);
describe("behind the change, never asked", never);
describe("made behind the change", scan());
out.push("they still run: " + [JSON.stringify([...fresh]), typeof begun.next().value, typeof never.next().value]);
console.log(out.join("\n"));
