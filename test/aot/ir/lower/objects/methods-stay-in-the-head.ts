// RUN: lower
// CHECK-LABEL: function {{*}}name="create"
// CHECK: = NewClosure function=
// CHECK: [[head]] = NewObject -, {{*}}fields=[0, 2, 1]
// CHECK-NEXT: = FinishObject [[head]]

// RUN(PIECES): lower
// PIECES-LABEL: function {{*}}name="create"
// PIECES-NOT: PropDefine
// PIECES-LABEL: function {{*}}name="createWithSuper"
// PIECES: [[head]] = NewObject -, [[a]] layout={{*}}fields=[0]
// PIECES: = NewClosure [[head]] function=
// PIECES: PropDefine [[head]], {{*}}key="m"
// PIECES: PropDefine [[head]], {{*}}key="b"
// PIECES: = FinishObject [[head]]

export function create() {
  return { a: 1, m() {}, b: 2 };
}

export function createWithSuper() {
  return {
    a: 1,
    m() {
      return super.x;
    },
    b: 2,
  };
}
