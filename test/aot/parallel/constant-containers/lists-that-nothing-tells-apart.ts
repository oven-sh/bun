// A list of constants that nothing changes and nothing can tell from another list made at the same place may be one cell for every evaluation.
// `good`, `goodTexts`, `goodFractions` and `goodNested` make such lists. Every other maker's lists are changed, compared, used as keys, watched, or handed to code that
// the compiler does not follow: each evaluation must give a list of its own. Every case runs in a hot loop, and prints what it saw in all its rounds.
function good(): number[] { return [1, 2, 3]; }
function goodTexts(): string[] { return ["a", "bb", "ccc"]; }
function goodFractions(): number[] { return [0.5, 1.5, 2.5]; }
function goodNested(): number[][] { return [[1, 2], [3]]; }
function compared(): number[] { return [1, 2, 4]; }
function looselyCompared(): number[] { return [1, 2, 40]; }
function pushed(): number[] { return [1, 2, 5]; }
function shortened(): number[] { return [1, 2, 6]; }
function frozen(): number[] { return [1, 2, 7]; }
function keyOfMap(): number[] { return [1, 2, 8]; }
function keyOfWeakMap(): number[] { return [1, 2, 9]; }
function handed(): number[] { return [1, 3, 1]; }
function insideEscaped(): number[] { return [1, 3, 2]; }
function returned(): number[] { return [1, 3, 3]; }
function through(): number[] { return returned(); }
function stored(): number[] { return [1, 3, 4]; }
function memberOfSet(): number[] { return [1, 3, 5]; }
function watched(): number[] { return [1, 3, 6]; }
function sameValue(): number[] { return [1, 3, 7]; }
function switched(): number[] { return [1, 3, 8]; }
function named(): number[] { return [1, 4, 1]; }
function parent(): number[] { return [1, 4, 2]; }
function relinked(): number[] { return [1, 4, 3]; }
function innerCompared(): number[][] { return [[1, 4], [4]]; }
function innerPushed(): number[][] { return [[1, 5], [5]]; }
function innerStored(): number[][] { return [[1, 6], [6]]; }
function holdsObject(): { a: number }[] { return [{ a: 1 }]; }
function needle(): number[] { return [1, 5, 1]; }
function inHaystack(): number[] { return [1, 5, 2]; }
function sorted(): number[] { return [3, 1, 2]; }
function reversed(): number[] { return [1, 5, 3]; }
function filled(): number[] { return [1, 5, 4]; }
function spliced(): number[] { return [1, 5, 5]; }
function defined(): number[] { return [1, 5, 6]; }
function deleted(): number[] { return [1, 5, 7]; }
function replaced(): number[] { return [1, 5, 8]; }
function keptAndWritten(): number[] { return [1, 6, 1]; }
function writtenByText(): number[] { return [1, 6, 2]; }
function assigned(): number[] { return [1, 6, 3]; }
function textsPushed(): string[] { return ["x", "y"]; }
function fractionsStored(): number[] { return [0.25, 0.75]; }

function twinA(): number[] { return [1, 7, 1]; }
function twinB(): number[] { return [1, 7, 1]; }
function twinKeyA(): number[] { return [1, 7, 2]; }
function twinKeyB(): number[] { return [1, 7, 2]; }
function twinNeedleA(): number[] { return [1, 7, 3]; }
function twinNeedleB(): number[] { return [1, 7, 3]; }
function twinInnerA(): number[][] { return [[1, 7], [4]]; }
function twinInnerB(): number[][] { return [[1, 7], [4]]; }
function twinsInOneTree(): number[][] { return [[1, 8], [1, 8]]; }
function twinWrittenA(): number[] { return [1, 7, 5]; }
function twinWrittenB(): number[] { return [1, 7, 5]; }

const unknown = (0, eval)("(function (holder) { holder.inner.push(7); return holder.inner.length; })") as (holder: { inner: number[] }) => number;
const writes = (0, eval)("(function (list) { list[1] = 70; })") as (list: number[]) => void;
const kept: number[][] = [];
const spreadSource = [1, 9, 1];
const spreadKept = [1, 9, 2];
const spreadSourceCompared = [1, 9, 3];
function spreadCompared(): number[] { return [...spreadSourceCompared]; }
function spreadOfKept(): number[] { return [...spreadKept]; }
const seen = new Map<string, Set<string>>();
function say(name: string, what: unknown): void {
  let answers = seen.get(name);
  if (!answers) seen.set(name, (answers = new Set()));
  answers.add(String(what));
}

function round(i: number): number {
  let sum = good()[1]! + goodTexts()[2]!.length + goodFractions()[i % 3]! + goodNested()[1]![0]! + goodNested()[0]![i & 1]! + good().length;
  for (let k = 0; k < good().length; k++) sum += good()[k]!;
  say("compared", compared() === compared());
  say("compared with itself", ((list: number[]) => list === list)(compared()));
  say("not equal", compared() !== compared());
  say("loosely", looselyCompared() == looselyCompared());
  const grown = pushed();
  grown.push(4);
  say("pushed", grown.length + " " + pushed().length);
  const short = shortened();
  short.length = 0;
  say("shortened", short.length + " " + shortened().length);
  Object.freeze(frozen());
  say("frozen", Object.isFrozen(frozen()));
  const map = new Map<number[], number>();
  map.set(keyOfMap(), 1).set(keyOfMap(), 2);
  say("key of a map", map.size + " " + map.has(keyOfMap()));
  const weak = new WeakMap<number[], number>();
  weak.set(keyOfWeakMap(), 1);
  say("key of a weak map", weak.has(keyOfWeakMap()));
  say("handed", JSON.stringify(handed(), function (this: unknown, _key: string, value: unknown) {
    if (Array.isArray(value) && value.length < 4) value.push(9);
    return value;
  }) + " " + handed().length);
  say("inside what escapes", unknown({ inner: insideEscaped() }) + " " + insideEscaped().length);
  say("returned", through() === through());
  stored()[0] = 9;
  say("stored", stored()[0]);
  const set = new Set<number[]>();
  set.add(memberOfSet()).add(memberOfSet());
  say("member of a set", set.size);
  say("watched", new WeakRef(watched()).deref() === watched());
  say("same value", Object.is(sameValue(), sameValue()));
  switch (switched()) {
    case switched():
      say("switched", "met");
      break;
    default:
      say("switched", "passed");
  }
  (named() as number[] & { extra?: number }).extra = 1;
  say("named", (named() as number[] & { extra?: number }).extra);
  say("parent", Object.getPrototypeOf(Object.create(parent())) === parent());
  Object.setPrototypeOf(relinked(), null);
  say("relinked", Object.getPrototypeOf(relinked()) === Array.prototype);
  say("inner compared", innerCompared()[0] === innerCompared()[0]);
  innerPushed()[0]!.push(9);
  say("inner pushed", innerPushed()[0]!.length);
  innerStored()[1]![0] = 60;
  say("inner stored", innerStored()[1]![0]);
  holdsObject()[0]!.a++;
  say("holds an object", holdsObject()[0]!.a);
  say("needle", [needle()].includes(needle()) + " " + [needle()].indexOf(needle()) + " " + [needle()].lastIndexOf(needle()));
  const one = inHaystack();
  say("in the haystack", [inHaystack(), one].indexOf(one));
  say("sorted", sorted().sort().join() + " " + sorted().join());
  say("reversed", reversed().reverse().join() + " " + reversed().join());
  say("filled", filled().fill(0).join() + " " + filled().join());
  say("spliced", spliced().splice(0, 2).join() + " " + spliced().join());
  Object.defineProperty(defined(), 0, { value: 50 });
  say("defined", defined()[0]);
  delete (deleted() as (number | undefined)[])[1];
  say("deleted", 1 in deleted());
  say("replaced", replaced().with(0, 8).join() + " " + replaced().join());
  const first = keptAndWritten();
  kept[i & 3] = first;
  kept[(i + 1) & 3] = keptAndWritten();
  kept[i & 3]![2] = i & 1;
  say("kept and written", kept[(i + 1) & 3]![2] + " " + keptAndWritten()[2] + " " + (first[2] === (i & 1)));
  writes(writtenByText());
  say("written by text", writtenByText()[1]);
  Object.assign(assigned(), [8]);
  say("assigned", assigned()[0]);
  textsPushed().push("z");
  say("texts pushed", textsPushed().join(""));
  fractionsStored()[1] = 9.5;
  say("fractions stored", fractionsStored()[1]);
  say("twins", twinA() === twinB());
  say("twins of a map", new Map<number[], number>([[twinKeyA(), 1]]).has(twinKeyB()));
  say("twins searched", [twinNeedleA()].includes(twinNeedleB()));
  say("inner twins", twinInnerA()[0] === twinInnerB()[0]);
  say("spreads compared", spreadCompared() === spreadCompared());
  const spread = [...spreadSource];
  spread.push(4);
  say("spread pushed", spread.length + " " + [...spreadSource].length);
  const spreads = [spreadOfKept(), spreadOfKept()];
  say("spreads kept", spreads[0] === spreads[1]);
  const tree = twinsInOneTree();
  say("twins in one tree", tree[0] === tree[1]);
  twinWrittenA()[2] = 50;
  say("written twin", twinWrittenB()[2]);
  return sum;
}

let total = 0;
for (let i = 0; i < 6000; i++) total += round(i);
console.log(total);
for (const [name, answers] of seen) console.log(name + ": " + [...answers].join(" | "));
console.log(JSON.stringify([good(), goodTexts(), goodFractions(), goodNested()]));
