// RUN: lower
// CHECK-LABEL: function {{*}}name="collect"
// CHECK: = IteratorOpen
// CHECK-NEXT: Jump -> next [[loop]](
// CHECK: LoopHint
// CHECK: = NewClassToken
// CHECK: = NewClass [[constructor]]
// CHECK: Jump -> next [[loop]](

// RUN(BEFORE): lower
// BEFORE-LABEL: function {{*}}name="collect"
// BEFORE-NOT: NewClass
// BEFORE: LoopHint

export function collect(items: number[]) {
  const list: unknown[] = [];
  for (const item of items) {
    list.push(
      class {
        #x = 1;
      },
    );
  }
  return list;
}
