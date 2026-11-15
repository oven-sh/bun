// RUN(INNER): lower
// INNER: [[outer]] = IteratorOpen
// INNER: [[inner]] = IteratorOpen
// INNER-COUNT-4: IteratorClose [[inner]]
// INNER-NOT: IteratorClose [[inner]]

// RUN(OUTER): lower
// OUTER: [[outer]] = IteratorOpen
// OUTER-COUNT-2: IteratorClose [[outer]]
// OUTER-NOT: IteratorClose [[outer]]

// RUN(THROWS): lower
// THROWS-COUNT-2: completion=Throw
// THROWS-NOT: completion=Throw

// RUN(ROLES): lower
// ROLES-COUNT-2: role=IterationCleanup
// ROLES-NOT: role=IterationCleanup

declare function use(value: unknown): void;
declare const flag: boolean;
declare const list: number[];

export function exits() {
  outer: for (const a of list) {
    for (const b of list) {
      if (flag) break;
      if (flag) continue;
      if (flag) continue outer;
      if (flag) return;
      use(a + b);
    }
  }
}
