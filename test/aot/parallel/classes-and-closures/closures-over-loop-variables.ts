// Each iteration of `for (let i ..)` has its own `i`, and the update stores to the new one. A closure keeps the `i` of the iteration that created it, wherever in the loop it was created and whatever else stores to `i`.
const out: string[] = [];
function say(name: string, ...values: unknown[]): void {
  out.push(name + ": " + values.map(String).join(" "));
}
function hold<T>(value: T): T {
  return [value][0];
}
type Read = () => number;
function call(reads: Read[]): number[] {
  return reads.map(read => read());
}

function createdInTheBody(n: number) {
  const reads: Read[] = [];
  for (let i = 0; i < n; i++) reads.push(() => i);
  return call(reads);
}
function calledWhileTheLoopRuns(n: number) {
  const reads: Read[] = [], seen: number[] = [];
  for (let i = 0; i < n; i++) {
    reads.push(hold(() => i));
    seen.push(...call(reads));
  }
  return seen;
}
function usedAtOnce(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += [1, 2, 3].map(x => x * i).reduce((a, b) => a + b, 0);
  return sum;
}
function otherUpdates() {
  const reads: Read[] = [];
  for (let i = 0; i < 10; i += 3) reads.push(() => i);
  for (let i = 8; i > 0; i = i >> 1) reads.push(() => i);
  for (let i = 3; i; --i) reads.push(() => i);
  for (let i = 0; i < 6; i++, i++) reads.push(() => i);
  for (let i = 1, j = 2; i < 20; [i, j] = [j, i + j]) reads.push(() => i * 100 + j);
  for (let [i, j] = [0, 10]; i < 3; i++, j--) reads.push(() => i * 100 + j);
  for (let x = 1; x < 40; x *= 2.5) reads.push(() => x);
  for (let i: number | undefined; (i ?? 0) < 3; i = (i ?? 0) + 1) reads.push(() => i ?? -1);
  return call(reads);
}
function createdInTheHead() {
  const reads: Read[] = [];
  for (let i = 5, first = () => i; i < 8; i++) reads.push(first, () => i);
  for (let first = () => i, i = 7; i < 9; i++) reads.push(first, () => i);
  for (let i = 0, j = 0, first = () => i * 10 + j; i < 2; i++, j += 2) reads.push(first, () => i * 10 + j);
  return call(reads);
}
function createdInTheTest() {
  const reads: Read[] = [];
  for (let i = 0; reads.push(() => i) < 4; i++);
  return call(reads);
}
function createdInTheUpdate() {
  const reads: Read[] = [];
  for (let i = 0; i < 3; reads.push(() => i), i++);
  for (let i = 0; i < 3; i++, reads.push(() => i));
  for (let i = 0; i < 3; reads.push(() => i * 10), i++) reads.push(() => i);
  return call(reads);
}
function updateCallsEarlierClosures() {
  const reads: Read[] = [], seen: number[] = [];
  for (let i = 0; i < 3; i++, seen.push(...call(reads))) reads.push(() => i);
  return seen;
}
function storedInTheBody() {
  const reads: Read[] = [];
  for (let i = 0; i < 9; i++) {
    reads.push(() => i);
    i += 2;
  }
  return call(reads);
}
function storedInTheTest() {
  const reads: Read[] = [];
  for (let i = 0; i++ < 6; i++) reads.push(() => i);
  return call(reads);
}
function storedByAClosure() {
  const reads: Read[] = [], bumps: Read[] = [];
  for (let i = 0; i < 3; i++) {
    reads.push(() => i);
    bumps.push(() => (i += 10));
  }
  return [...call(reads), ...call(bumps), ...call(reads)];
}
function storedByAClosureTheUpdateCalls() {
  const reads: Read[] = [];
  for (let i = 0, step = () => ++i; i < 3; step()) {
    reads.push(() => i, step);
    if (reads.length > 5) break;
  }
  return call(reads);
}
function storedByAnInnerUpdate() {
  const reads: Read[] = [];
  for (let i = 0; i < 6; i++) {
    reads.push(() => i);
    for (let j = 0; j < 2; j++, i++) reads.push(() => i * 10 + j);
  }
  return call(reads);
}
function outerVariableInTheUpdate() {
  const reads: Read[] = [];
  let count = 0;
  for (let i = 0; i < 3; i++, count += 2) reads.push(() => i * 10 + count);
  return call(reads);
}
function declaredWithVar() {
  const reads: Read[] = [];
  for (var i = 0; i < 3; i++) reads.push(() => i);
  return call(reads);
}
function seenByEval() {
  const reads: Read[] = [];
  for (let i = 0; i < 3; i++) {
    reads.push(() => i);
    if (i === 1) eval("i += 10; reads.push(() => i)");
  }
  return call(reads);
}
function continued() {
  const reads: Read[] = [];
  for (let i = 0; i < 6; i++) {
    if (i % 2) continue;
    reads.push(() => i);
    if (i < 3) continue;
    reads.push(() => -i);
  }
  return call(reads);
}
function labeled() {
  const reads: Read[] = [];
  outer: for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (j === 2) continue outer;
      if (i === 2) break outer;
      reads.push(() => i * 10 + j);
    }
  }
  return call(reads);
}
function leftByAThrow() {
  const reads: Read[] = [];
  try {
    for (let i = 0; ; i++) {
      reads.push(() => i);
      if (i === 2) throw new Error("stop");
    }
  } catch {}
  return call(reads);
}
function twoVariables() {
  const reads: Read[] = [];
  for (let i = 0, j = 0; i < 4; i++, j++) {
    reads.push(() => i * 100 + j);
    if (i % 2) j += 5;
  }
  return call(reads);
}
function passedOn() {
  const makers: (() => Read)[] = [];
  for (let i = 0; i < 3; i++) makers.push(() => () => i);
  return makers.map(make => make()());
}
function classesInTheBody() {
  const made: { read(): number }[] = [];
  for (let i = 0; i < 3; i++) {
    made.push(
      new (class {
        kept = i * 2;
        static first = i;
        read() {
          return i * 100 + this.kept;
        }
      })(),
    );
  }
  return made.map(one => one.read());
}
function declaredFunctions() {
  const reads: Read[] = [];
  for (let i = 0; i < 3; i++) {
    reads.push(read, () => i * 10);
    function read(): number {
      return i;
    }
  }
  return call(reads);
}
function reentered(depth: number): Read[] {
  const reads: Read[] = [];
  for (let i = 0; i < 2; i++) {
    reads.push(() => depth * 10 + i);
    if (depth > 0 && i === 0) reads.push(...reentered(depth - 1));
  }
  return reads;
}
function* generated(n: number) {
  for (let i = 0; i < n; i++) yield () => i;
}
async function awaited(n: number) {
  const reads: Read[] = [];
  for (let i = 0; i < n; i += await Promise.resolve(1)) {
    reads.push(() => i);
    await null;
    reads.push(() => i + 100);
  }
  return call(reads);
}
async function timers() {
  const seen: number[] = [];
  await new Promise<void>(resolve => {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        seen.push(i);
        if (seen.length === 3) resolve();
      }, 0);
    }
  });
  return seen;
}
interface ChainLink {
  name: string;
  next: ChainLink | null;
}
function otherTypes() {
  const reads: (() => unknown)[] = [];
  const chain: ChainLink = { name: "a", next: { name: "b", next: { name: "c", next: null } } };
  for (let text = "a"; text.length < 4; text += "b") reads.push(() => text);
  for (let link: ChainLink | null = chain; link; link = link.next) reads.push(() => (link ? link.name : "none"));
  for (let big = 1n; big < 100n; big *= 7n) reads.push(() => big);
  for (let v: number | string = 0; typeof v === "number"; v = v < 2 ? v + 1 : "done") reads.push(() => v);
  return reads.map(read => read());
}
function readBeforeInitialization() {
  const seen: string[] = [];
  try {
    for (let early = hold(() => i)(), i = 0; i < 1; i++) seen.push(String(early));
  } catch (error) {
    seen.push((error as Error).name);
  }
  return seen;
}
function manyIterations() {
  const reads: Read[] = [];
  for (let i = 0; i < 1000; i++) reads.push(() => i);
  let sum = 0;
  for (const read of reads) sum += read();
  return sum;
}
const atTheTopLevel: Read[] = [];
for (let i = 0; i < 3; i++) atTheTopLevel.push(() => i);

say("created in the body", ...createdInTheBody(4));
say("called while the loop runs", ...calledWhileTheLoopRuns(3));
say("used at once", usedAtOnce(5));
say("other updates", ...otherUpdates());
say("created in the head", ...createdInTheHead());
say("created in the test", ...createdInTheTest());
say("created in the update", ...createdInTheUpdate());
say("update calls earlier closures", ...updateCallsEarlierClosures());
say("stored in the body", ...storedInTheBody());
say("stored in the test", ...storedInTheTest());
say("stored by a closure", ...storedByAClosure());
say("stored by a closure the update calls", ...storedByAClosureTheUpdateCalls());
say("stored by an inner update", ...storedByAnInnerUpdate());
say("outer variable in the update", ...outerVariableInTheUpdate());
say("declared with var", ...declaredWithVar());
say("seen by eval", ...seenByEval());
say("continued", ...continued());
say("labeled", ...labeled());
say("left by a throw", ...leftByAThrow());
say("two variables", ...twoVariables());
say("passed on", ...passedOn());
say("classes in the body", ...classesInTheBody());
say("declared functions", ...declaredFunctions());
say("reentered", ...call(reentered(2)));
say("generated", ...[...generated(3)].map(read => read()));
say("awaited", ...(await awaited(3)));
say("timers", ...(await timers()));
say("other types", ...otherTypes());
say("read before initialization", ...readBeforeInitialization());
say("many iterations", manyIterations());
say("at the top level", ...call(atTheTopLevel));
console.log(out.join("\n"));
