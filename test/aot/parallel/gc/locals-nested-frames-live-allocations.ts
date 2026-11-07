// Objects that only local variables of nine nested frames hold stay alive while allocation after allocation makes the collector run: the frames stand at calls that can do nothing but collect, some under a handler, some not. What is thrown afterwards reaches the handler in force.
class Link {
  constructor(
    public value: number,
    public next: Link | null,
  ) {}
}

function chain(length: number, seed: number): Link | null {
  let head: Link | null = null;
  for (let index = 0; index < length; index++) head = new Link(seed + index, head);
  return head;
}

function sum(link: Link | null): number {
  let total = 0;
  for (; link; link = link.next) total += link.value;
  return total;
}

function churn(rounds: number): number {
  let kept = 0;
  for (let round = 0; round < rounds; round++) {
    const garbage = { first: round, pair: [round, round + 1], text: "x" + round };
    kept += garbage.pair.length + garbage.text.length;
  }
  return kept;
}

function holds(depth: number): number {
  const mine = chain(50, depth * 1000);
  const before = sum(mine);
  let below = 0;
  try {
    below = depth ? holds(depth - 1) : churn(2_000_000);
    if (depth % 3 === 0) throw new RangeError("from depth " + depth);
  } catch (error) {
    below += (error as Error).message.length;
  }
  const more = chain(20, depth);
  below += churn(100_000) % 7;
  if (sum(mine) !== before) throw new Error("an object that a local variable holds has changed");
  return before + below + sum(more);
}

console.log(holds(8));
console.log(holds(2));
