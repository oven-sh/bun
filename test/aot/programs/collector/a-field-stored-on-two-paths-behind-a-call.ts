// A field that holds an object holds the 32-bit number of its cell. Each function below stores a parameter into such a field on paths behind a call that collects, so the number is computed once, in front of the call, and that is the last use of the full pointer.
// Nobody but the parameter holds the object. The .json asks the build to prove that a pointer stays beside the number over the call, and turns off the collector's scan for such numbers, so that the pointer alone keeps the object alive.
const collect: () => void = typeof (globalThis as any).gc === "function" ? (globalThis as any).gc : () => Bun.gc(true);

class Link {
  next: Link | null = null;
  prev: Link | null = null;
  label: string;
  constructor(label: string) {
    this.label = label;
  }
}

interface Status {
  kind: number;
  cause: Link;
}

// What it allocates behind the collection takes the place of whatever the collection freed.
let calls = 0;
let made = 0;
function work(): void {
  if (++calls % 3 === 0) collect();
  const scratch: Link[] = [];
  for (let i = 0; i < 12; i++) scratch.push(new Link("scratch" + i));
  made += scratch.length;
}

function link(a: Link, b: Link, flag: boolean): void {
  work();
  if (flag) a.next = b;
  else a.prev = b;
}

function linkOrClear(a: Link, b: Link | null, flag: boolean): void {
  work();
  if (flag) a.next = b;
  else a.prev = b;
}

// The number stays the same in the loop, so it is computed in front of the loop, and the only store comes behind the last of many calls.
function markOutOfDate(statuses: Map<string, Status>, names: string[], cause: Link): void {
  for (let i = 0; i < names.length; i++) {
    work();
    const status = statuses.get(names[i]);
    if (status !== undefined && status.kind === 1) statuses.set(names[i], { kind: 2, cause });
  }
}

const wrong: string[] = [];
function expectLabel(where: string, found: Link | null, label: string | null): void {
  const seen = found === null ? null : found.label;
  if (seen !== label) wrong.push(where + ": " + seen + " instead of " + label);
}

const names = ["a", "b", "c", "d", "e", "f"];
const anchor = new Link("anchor");
const first = new Link("first");
for (let round = 0; round < 45; round++) {
  const forward = (round & 1) === 0;
  link(anchor, new Link("link" + round), forward);
  expectLabel("link " + round, forward ? anchor.next : anchor.prev, "link" + round);

  linkOrClear(anchor, round % 3 === 0 ? null : new Link("other" + round), !forward);
  expectLabel("linkOrClear " + round, forward ? anchor.prev : anchor.next, round % 3 === 0 ? null : "other" + round);

  const statuses = new Map<string, Status>();
  for (const name of names) statuses.set(name, { kind: name === "f" ? 1 : 0, cause: first });
  markOutOfDate(statuses, names, new Link("cause" + round));
  const marked = statuses.get("f");
  expectLabel("markOutOfDate " + round, marked === undefined || marked.kind !== 2 ? null : marked.cause, "cause" + round);
}
console.log(wrong.length === 0 ? "every field holds what was stored" : wrong.join("\n"));
console.log(calls, made, anchor.next === null ? "nothing" : anchor.next.label, anchor.prev === null ? "nothing" : anchor.prev.label);
