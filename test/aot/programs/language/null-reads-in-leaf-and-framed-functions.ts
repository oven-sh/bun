// A property read or store through a typed reference that is null throws a TypeError at its own line: in a leaf function and in one with a frame, caught in a caller and in the same function, through a parameter and through a field. The same code throws nothing for an object.
class Link {
  value: number;
  next: Link | null;
  constructor(value: number, next: Link | null) {
    this.value = value;
    this.next = next;
  }
}

function report(error: unknown): string {
  const position = /:(\d+):\d+\)?$/m.exec((error as Error).stack ?? "");
  return (error instanceof TypeError ? "TypeError" : "another error") + " at line " + (position ? position[1] : "unknown");
}

function sum(depth: number): number {
  return depth === 0 ? 0 : depth + sum(depth - 1);
}

function readInLeaf(link: Link | null): number {
  return link!.value;
}

function readFieldInLeaf(link: Link): number {
  return link.next!.value;
}

function storeInLeaf(link: Link | null, value: number): number {
  link!.value = value;
  return value;
}

function readWithFrame(link: Link | null): number {
  const before = sum(3);
  const value = link!.value;
  return before + value + sum(4);
}

function readFieldWithFrame(link: Link): number {
  const before = sum(3);
  const value = link.next!.value;
  return before + value + sum(4);
}

function catchOwnReadInLeaf(link: Link | null, fallback: number): number {
  try {
    return link!.value;
  } catch {
    return fallback;
  }
}

function catchOwnReadWithFrame(link: Link | null, a: number, b: number, c: number): string {
  let total = a * 3 + b;
  let outcome = "no error";
  try {
    total += sum(c);
    total += link!.value;
    total += sum(a);
  } catch (error) {
    outcome = report(error);
  }
  return outcome + ", total " + (total + a + b + c);
}

function catchReadOfLeaf(link: Link | null, a: number, b: number): string {
  let total = a + b;
  try {
    total += readInLeaf(link);
  } catch (error) {
    return report(error) + ", total " + (total * a - b);
  }
  return "no error, total " + (total * a - b);
}

function attempt(label: string, run: () => number | string): void {
  let outcome: string;
  try {
    outcome = String(run());
  } catch (error) {
    outcome = report(error);
  }
  console.log(label + ": " + outcome);
}

const last = new Link(5, null);
const first = new Link(2, last);

for (const link of [first, null, last]) {
  attempt("read in a leaf function", () => readInLeaf(link));
  attempt("store in a leaf function", () => storeInLeaf(link, 7));
  attempt("read in a function with a frame", () => readWithFrame(link));
  attempt("read caught in the same leaf function", () => catchOwnReadInLeaf(link, -1));
  attempt("read caught in the same function with a frame", () => catchOwnReadWithFrame(link, 2, 3, 4));
  attempt("read in a leaf function caught in its caller", () => catchReadOfLeaf(link, 6, 7));
}

for (const link of [first, last]) {
  attempt("read of a field's field in a leaf function", () => readFieldInLeaf(link));
  attempt("read of a field's field in a function with a frame", () => readFieldWithFrame(link));
}

export {};
