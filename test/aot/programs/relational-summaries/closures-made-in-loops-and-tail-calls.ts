// Every round of a loop has variables of its own, and every call of a function that calls itself last has a frame of its own, even where the compiler makes one storage of them. A closure that is only called in 99 rounds and kept in the hundredth must hold the variables of ITS round, as they were left by that round, whatever later rounds write.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
function call<T>(f: () => T): T {
  return f();
}
const kept: (() => string)[] = [];
const rare = (i: number) => i % 100 === 99;
const flush = () => kept.splice(0).map(f => f()).join(" ");

function countedLoop(): number {
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    const read = () => "i" + i;
    sum += call(read).length;
    if (rare(i)) kept.push(read);
  }
  return sum;
}
function constInTheBody(): number {
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    const box = { n: i };
    let count = 0;
    const read = () => "box" + box.n + "." + ++count;
    sum += call(read).length;
    box.n += 1000;
    if (rare(i)) kept.push(read);
  }
  return sum;
}
function forOf(): number {
  let sum = 0;
  const items = Array.from({ length: 300 }, (_, i) => ({ n: i }));
  for (const item of items) {
    const read = () => "item" + item.n;
    sum += call(read).length;
    if (rare(item.n)) kept.push(read);
  }
  return sum;
}
function forIn(): number {
  let sum = 0;
  for (const key in { a: 1, b: 2, c: 3 }) {
    const read = () => "key " + key;
    sum += call(read).length;
    kept.push(read);
  }
  return sum;
}
function whileLoop(): number {
  let sum = 0;
  let i = 0;
  while (i < 300) {
    const mine = i;
    const read = () => "mine" + mine + " shared" + i;
    sum += call(read).length;
    if (rare(i)) kept.push(read);
    i++;
  }
  return sum;
}
function varInALoop(): number {
  let sum = 0;
  for (var v = 0; v < 300; v++) {
    var inner = v * 2;
    const read = () => "v" + v + " inner" + inner;
    sum += call(read).length;
    if (rare(v)) kept.push(read);
  }
  return sum;
}
function theClosureWritesTheCounter(): string {
  const seen: number[] = [];
  for (let i = 0; i < 10; i++) {
    seen.push(i);
    call(() => {
      i += 2;
    });
    if (i === 5) kept.push(() => "counter as round 3 left it: " + i);
  }
  return seen.join();
}
function closuresInTheHead(): string {
  const reads: (() => number)[] = [];
  for (let i = 0, first = () => i; i < 3; reads.push(() => i), i++) {
    if (i === 0) reads.push(first);
  }
  return reads.map(f => f()).join();
}
function nestedLoops(): number {
  let sum = 0;
  for (let i = 0; i < 20; i++) {
    const outer = { i };
    for (let j = 0; j < 20; j++) {
      const read = () => outer.i + ":" + j;
      sum += call(read).length;
      if (i === 19 && j % 9 === 8) kept.push(read);
    }
    outer.i += 100;
  }
  return sum;
}
function continueAndBreak(): number {
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    const read = () => "c" + i;
    if (i % 2) {
      if (rare(i)) kept.push(read);
      continue;
    }
    sum += call(read).length;
    if (i === 250) {
      kept.push(read);
      break;
    }
  }
  return sum;
}
function switchInALoop(): number {
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    switch (i % 100) {
      case 99: {
        const only = { tag: "case " + i };
        kept.push(() => only.tag);
        break;
      }
      default: {
        const only = { tag: "default" };
        sum += call(() => only.tag).length;
      }
    }
  }
  return sum;
}
function tryInALoop(): number {
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    try {
      if (rare(i)) throw { tag: "thrown " + i };
      sum++;
    } catch (e) {
      kept.push(() => (e as { tag: string }).tag);
    } finally {
      const last = { tag: "finally " + i };
      if (rare(i)) kept.push(() => last.tag);
    }
  }
  return sum;
}
for (const loop of [countedLoop, constInTheBody, forOf, forIn, whileLoop, varInALoop, theClosureWritesTheCounter, closuresInTheHead, nestedLoops, continueAndBreak, switchInALoop, tryInALoop]) {
  const answer = loop();
  console.log(loop.name, answer, churn(40), flush());
}

// A function that calls itself last.
function tail(n: number, acc: number): number {
  const mine = { n };
  let local = n;
  const read = () => "tail" + mine.n + "." + local;
  acc += call(read).length;
  local = -n;
  if (rare(n)) kept.push(read);
  return n === 0 ? acc : tail(n - 1, acc);
}
function tailWithParameters(n: number, carried: { tag: string }): string {
  if (rare(n)) kept.push(() => carried.tag + "@" + n);
  return n === 0 ? carried.tag : tailWithParameters(n - 1, { tag: "carried " + n });
}
function tailThatStoresToItsParameter(n: number, text: string): string {
  const read = () => text + n;
  if (rare(n)) kept.push(read);
  text = "changed" + n + " ";
  if (n === 0) return call(read);
  return tailThatStoresToItsParameter(n - 1, "passed" + n + " ");
}
function evenTail(n: number): string {
  const mine = { tag: "even " + n };
  if (n % 100 === 50) kept.push(() => mine.tag);
  return n === 0 ? "done" : oddTail(n - 1);
}
function oddTail(n: number): string {
  const mine = { tag: "odd " + n };
  if (rare(n)) kept.push(() => mine.tag);
  return evenTail(n - 1);
}
console.log(tail(300, 0), churn(40), flush());
console.log(tailWithParameters(300, { tag: "first" }), churn(40), flush());
console.log(tailThatStoresToItsParameter(300, "first "), churn(40), flush());
console.log(evenTail(300), churn(40), flush());

// Objects of one round are compared with those of the next.
function roundsAreApart(): string {
  let previous: { n: number } | null = null;
  let previousRead: (() => number) | null = null;
  let same = 0;
  let stale = 0;
  for (let i = 0; i < 200; i++) {
    const o = { n: i };
    const read = () => o.n;
    if (previous === o || previousRead === read) same++;
    if (previous && (previous.n !== i - 1 || previousRead!() !== i - 1)) stale++;
    previous = o;
    previousRead = read;
  }
  return same + "/" + stale;
}
console.log(roundsAreApart());

// Each call makes an object that holds the one its caller made, hands it to the next call, and nobody keeps any of them: in a recursion every frame is still there when the last call walks the chain. Where the last call becomes a jump there is one frame.
interface Chain {
  n: number;
  prev: Chain | null;
}
function total(from: Chain | null): string {
  let sum = 0;
  let links = 0;
  for (let at = from; at !== null && links < 10000; at = at.prev) {
    sum += at.n;
    links++;
  }
  return links + ":" + sum;
}
function chainByTailCalls(n: number, prev: Chain | null): string {
  const mine: Chain = { n, prev };
  return n === 0 ? total(mine) : chainByTailCalls(n - 1, mine);
}
function chainOfClosures(n: number, prev: () => number): number {
  const mine = () => n + prev();
  return n === 0 ? mine() : chainOfClosures(n - 1, mine);
}
function chainByTwo(n: number, prev: Chain | null): string {
  const mine: Chain = { n, prev };
  return n === 0 ? total(mine) : chainByTwoOther(n - 1, mine);
}
function chainByTwoOther(n: number, prev: Chain | null): string {
  const mine: Chain = { n: -n, prev };
  return n === 0 ? total(mine) : chainByTwo(n - 1, mine);
}
function chainInALoop(count: number): string {
  let prev: Chain | null = null;
  for (let i = 0; i <= count; i++) {
    const mine: Chain = { n: i, prev };
    prev = mine;
  }
  return total(prev);
}
function lastTwoInALoop(count: number): string {
  let last: Chain | null = null;
  let beforeLast: Chain | null = null;
  for (let i = 0; i < count; i++) {
    const mine: Chain = { n: i, prev: null };
    beforeLast = last;
    last = mine;
  }
  return last!.n + "," + beforeLast!.n + "," + (last === beforeLast);
}
function accumulates(n: number, acc: number[]): string {
  const next = [...acc, n];
  return n === 0 ? next.join("") : accumulates(n - 1, next);
}
console.log(chainByTailCalls(300, null), chainOfClosures(300, () => 0), chainByTwo(300, null), chainInALoop(300), lastTwoInALoop(300), accumulates(9, []));

// A function declaration is one closure for each entry into its scope: the same wherever it is named there, another in the next call and in the next round.
function declaredOnce(): (() => number)[] {
  function inner(): number {
    return 1;
  }
  return [inner, inner, (() => inner)()];
}
function declaredInRounds(): (() => number)[] {
  const all: (() => number)[] = [];
  for (let i = 0; i < 3; i++) {
    function inRound(): number {
      return i;
    }
    all.push(inRound, inRound);
  }
  return all;
}
function counted(): number {
  return ++(counted as unknown as { calls: number }).calls;
}
(counted as unknown as { calls: number }).calls = 0;
class Declared {
  static uses = 0;
}
const once = declaredOnce();
const rounds = declaredInRounds();
const registry = new Map<unknown, string>([
  [counted, "the function"],
  [Declared, "the class"],
]);
console.log(once[0] === once[1], once[1] === once[2], declaredOnce()[0] === once[0], rounds[0] === rounds[1], rounds[1] === rounds[2], rounds.map(f => f()).join(""), counted(), counted(), call(counted), registry.get(counted), registry.get(Declared), ++Declared.uses, ++Declared.uses, [counted].includes(counted), new Set([Declared, Declared]).size);
