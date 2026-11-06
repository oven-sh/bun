// `head = { next: head, value }` in a loop: each new object holds the one before it. Lists, stacks and trees that grow this way, cut off now and then,
// dropped, walked, or handed on while they grow, hold what they hold in plain Bun.
type Link = { next: Link | null; value: number };
type Scope = { parent: Scope | null; names: string[]; depth: number };
type Tree = { left: Tree | null; right: Tree | null; weight: number };

function walk(head: Link | null): string {
  let sum = 0,
    length = 0;
  for (let link = head; link; link = link.next) {
    sum += link.value;
    length++;
  }
  return sum + "/" + length;
}
function grow(count: number): string {
  let head: Link | null = null;
  for (let i = 0; i < count; i++) head = { next: head, value: i };
  return walk(head);
}
function growAndCut(count: number, every: number): string {
  let head: Link | null = null;
  for (let i = 0; i < count; i++) head = { next: i % every === 0 ? null : head, value: i };
  return walk(head);
}
function growOnSomeTurns(count: number): string {
  let head: Link | null = null;
  for (let i = 0; i < count; i++) {
    if (i % 3 === 1) continue;
    head = { next: head, value: i };
    if (i % 7 === 0) head = head.next;
  }
  return walk(head);
}
function growTwo(count: number): string {
  let even: Link | null = null,
    odd: Link | null = null;
  for (let i = 0; i < count; i++) {
    if (i & 1) odd = { next: even, value: i };
    else even = { next: odd, value: i };
  }
  return walk(even) + " " + walk(odd);
}
function onlyTheLast(count: number): number {
  let head: Link | null = null;
  for (let i = 0; i < count; i++) head = { next: head, value: i * 2 };
  return head ? head.value : -1;
}
function neverRead(count: number): number {
  let head: Link | null = null;
  for (let i = 0; i < count; i++) head = { next: head, value: i };
  return count;
}
function scopes(depth: number): string {
  let scope: Scope | null = null;
  for (let i = 0; i < depth; i++) scope = { parent: scope, names: ["n" + i], depth: scope ? scope.depth + 1 : 0 };
  let text = "";
  for (let s = scope; s; s = s.parent) text += s.names[0] + ":" + s.depth + ",";
  return text;
}
function spine(count: number): number {
  let tree: Tree | null = null;
  for (let i = 0; i < count; i++)
    tree = i & 1 ? { left: tree, right: null, weight: i } : { left: null, right: tree, weight: i };
  let sum = 0;
  for (let t = tree; t; t = t.left ?? t.right) sum += t.weight;
  return sum;
}
function ring(count: number): string {
  const first: Link = { next: null, value: -1 };
  let last = first;
  for (let i = 0; i < count; i++) {
    const link: Link = { next: first, value: i };
    last.next = link;
    last = link;
  }
  let sum = 0,
    steps = 0;
  for (let link = first.next; link && link !== first; link = link.next) {
    sum += link.value;
    steps++;
  }
  return sum + "/" + steps;
}
const kept: (Link | null)[] = [];
function keepSome(count: number): string {
  let head: Link | null = null;
  for (let i = 0; i < count; i++) {
    head = { next: head, value: i };
    if (i % 5 === 0) kept.push(head);
  }
  return walk(kept[kept.length - 1]!);
}
function changeWhileGrowing(count: number): string {
  let head: Link | null = null;
  for (let i = 0; i < count; i++) {
    if (head) head.value += 100;
    head = { next: head, value: i };
  }
  return walk(head);
}

const lines: string[] = [];
for (let round = 0; round < 300; round++) {
  const count = round % 23;
  const line = [
    grow(count),
    growAndCut(count, 1 + (round % 5)),
    growOnSomeTurns(count),
    growTwo(count),
    onlyTheLast(count),
    neverRead(count),
    scopes(count % 6),
    spine(count),
    ring(count),
    keepSome(count),
    changeWhileGrowing(count),
  ].join(" | ");
  if (round < 24 || round % 71 === 0) lines.push(line);
}
console.log(grow(100000), growAndCut(100000, 1024), kept.length);
console.log(lines.join("\n"));
