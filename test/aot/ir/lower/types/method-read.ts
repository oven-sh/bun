// RUN: link
// CHECK-NOT: name="bump"{{*}}functionTypes=

// Checked code asks of every member that it reads whether its numbers are `int32`s. The question declares nothing: no position has the type of the callee of
// `counter.bump()`, so the method stands below no function type.
class Counter {
  count = 0;
  bump(): number {
    return ++this.count;
  }
}

export function probe(counter: Counter) {
  return counter.bump() + counter.count;
}
