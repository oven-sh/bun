// Recursive functions whose every return hands over a new object: what they answer, and what their callers see of the objects afterwards.
export {};

type Parsed = { node: string; next: number };

function nest(i: number, end: number): Parsed {
  if (i >= end) return { node: "leaf" + i, next: i + 1 };
  const inner = nest(i + 1, end);
  return { node: "(" + inner.node + ")", next: inner.next };
}

const text = "(a(bc)(d(e))f)";

// The call in tail position leads to a function that comes back here by a call that is none.
function parseItem(i: number): Parsed {
  if (text.charAt(i) === "(") return parseGroup(i + 1);
  return { node: text.charAt(i), next: i + 1 };
}

function parseGroup(i: number): Parsed {
  let node = "[";
  while (text.charAt(i) !== ")") {
    const item = parseItem(i);
    node += item.node;
    i = item.next;
  }
  return { node: node + "]", next: i + 1 };
}

let unwound = 0;

// It returns what its own call returns, and the call is no tail call.
function descend(depth: number): { depth: number; label: string } {
  if (!depth) return { depth, label: "bottom" };
  try {
    return descend(depth - 1);
  } finally {
    unwound++;
  }
}

function firstOdd(values: number[], i: number): { value: number } | null {
  if (i >= values.length) return null;
  const value = values[i]!;
  if (value % 2) return { value };
  const found = firstOdd(values, i + 1);
  return found;
}

const kept: { id: number }[] = [];

// Not new to its callers: the list holds the object too.
function makeAndKeep(id: number): { id: number } {
  if (id >= 3) {
    const made = { id };
    kept.push(made);
    return made;
  }
  const made = makeAndKeep(id + 1);
  return made;
}

// Not new to its callers: the object that comes back is one that an outer call has made and still names.
function handDown(n: number, outer: { n: number; same?: boolean } | null): { n: number; same?: boolean } {
  const own: { n: number; same?: boolean } = { n };
  if (!n) return outer ?? own;
  const back = handDown(n - 1, own);
  own.same = back === own;
  return back;
}

const first = nest(0, 4);
const second = nest(0, 4);
console.log(first.node, first.next, first === second, first === first);
first.next = -1;
console.log(first.next, second.next, Object.keys(first).join(), JSON.stringify(second));

const parsed = parseItem(0);
console.log(parsed.node, parsed.next, text.length);

const bottom = descend(5);
console.log(bottom.depth, bottom.label, unwound);

console.log(firstOdd([2, 4, 7, 9], 0)?.value, firstOdd([2, 4], 0), firstOdd([], 0));

console.log(makeAndKeep(0) === kept[0], kept.length);

const handed = handDown(3, null);
console.log(handed.n, handed.same);
