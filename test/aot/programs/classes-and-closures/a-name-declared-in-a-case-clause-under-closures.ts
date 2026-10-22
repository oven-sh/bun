// A const, let or class that stands directly in a case clause, under closures of the same clause, of other clauses and of the case tests: each reads what plain Bun reads, or throws what plain Bun throws
function attempt(run: () => unknown): string {
  try { return String(run()); } catch (error) { return (error as Error).constructor.name; }
}
function sameClause(k: number, n: number): () => number {
  switch (k) {
    case 0: const a = n + 1; return () => a;
    case 1: return () => -1;
    default: return () => -2;
  }
}
function storedInClause(k: number, n: number): () => number {
  switch (k) {
    case 0: let a = n; a = a * 2; if (n > 1) return (() => () => a) as unknown as () => number; return () => a;
    default: return () => -2;
  }
}
function nextClause(k: number): () => number {
  switch (k) {
    case 0: const a = k + 5;
    case 1: return () => a;
    default: return () => -2;
  }
}
function earlierClause(k: number): (() => number)[] {
  const all: (() => number)[] = [];
  switch (k) {
    case 0: all.push(() => a);
    case 1: const a = k + 7; all.push(() => a);
    case 2: all.push(() => a);
  }
  return all;
}
function beforeDeclaration(k: number): string {
  switch (k) {
    case 0: const early = () => a; const first = attempt(early); const a = k + 3; return first + early();
    default: return "";
  }
}
function inCaseTest(k: unknown): string {
  let kept: () => unknown = () => "none";
  switch (k) {
    case (kept = () => a, 1): const a: unknown[] = [k]; return attempt(kept);
    case 2: return attempt(kept);
    default: return attempt(kept);
  }
}
function storedInLaterClause(k: number): number[] {
  const all: (() => number)[] = [];
  for (const step of [k, 1]) {
    switch (step) {
      case 0: let a = 1; all.push(() => a); a = 2; all.push(() => a); break;
      case 1: all.push(() => 0);
    }
  }
  return all.map(f => f());
}
function sharedAcrossClauses(): number[] {
  const all: (() => number)[] = [];
  switch (0 as number) {
    case 0: let a = 1; all.push(() => a);
    case 1: a = 2; all.push(() => a);
  }
  return all.map(f => f());
}
function hoistedInClause(k: number): string {
  switch (k) {
    case 0: function read() { return a; } const first = attempt(read); const a = k + 4; return first + read();
    default: return "";
  }
}
function inLoop(): number[] {
  const all: (() => number)[] = [];
  for (let i = 0; i < 4; i++) {
    switch (i & 1) {
      case 0: const a = i * 10; all.push(() => a); break;
      case 1: const b = i; all.push(() => b); continue;
    }
  }
  return all.map(f => f());
}
function nestedSwitches(k: number, j: number): () => number {
  switch (k) {
    case 0:
      const a = k + 1;
      switch (j) {
        case 0: const b = j + 2; return () => a + b;
        case 1: return () => a;
      }
      return () => a * 10;
    default: return () => 0;
  }
}
function classInClause(k: number): string {
  switch (k) {
    case 0: class Local { name() { return "local"; } } return (() => new Local().name())();
    case 1: return attempt(() => new Local().name());
    default: return "";
  }
}
console.log(sameClause(0, 1)(), sameClause(1, 1)(), sameClause(2, 1)(), storedInClause(0, 1)(), (storedInClause(0, 2)() as unknown as () => number)(), storedInClause(1, 1)());
console.log(nextClause(0)(), attempt(nextClause(1)), nextClause(2)());
console.log(earlierClause(0).map(f => attempt(f)).join(), earlierClause(1).map(f => attempt(f)).join(), earlierClause(2).map(f => attempt(f)).join());
console.log(beforeDeclaration(0), inCaseTest(1), inCaseTest(2), inCaseTest(3));
console.log(storedInLaterClause(0).join(), sharedAcrossClauses().join(), hoistedInClause(0), hoistedInClause(1));
console.log(inLoop().join(), nestedSwitches(0, 0)(), nestedSwitches(0, 1)(), nestedSwitches(0, 2)(), nestedSwitches(1, 0)(), classInClause(0), classInClause(1));
