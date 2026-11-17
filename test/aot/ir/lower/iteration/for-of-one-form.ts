// RUN(OPENS): lower
// OPENS-COUNT-6: = IteratorOpen
// OPENS-NOT: = IteratorOpen

// RUN(STEPS): lower
// STEPS-COUNT-6: = IteratorResume
// STEPS-NOT: = IteratorResume

// RUN(PROTOCOL): lower
// PROTOCOL-NOT: @@iterator
// PROTOCOL-NOT: key="next"
// PROTOCOL-NOT: key="done"
// PROTOCOL-NOT: key="length"
// PROTOCOL-NOT: ElemGet
// PROTOCOL-NOT: iteratorKind=Async
// PROTOCOL-NOT: isDestructuring

declare function use(value: unknown): void;

function* numbers() {
  yield 1;
}

export function overArray(items: number[]) {
  for (const item of items) use(item);
}

export function overMap(items: Map<string, number>) {
  for (const item of items) use(item);
}

export function overSet(items: Set<number>) {
  for (const item of items) use(item);
}

export function overString(items: string) {
  for (const item of items) use(item);
}

export function overGenerator() {
  for (const item of numbers()) use(item);
}

export function overAnything(items: any) {
  for (const item of items) use(item);
}
