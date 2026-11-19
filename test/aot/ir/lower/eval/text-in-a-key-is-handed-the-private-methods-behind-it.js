// RUN: lower
// CHECK-LABEL: function {{*}}name="define"
// CHECK: = NewClass [[constructor]] layout=
// CHECK: [[total]] = NewClosure {{*}}function=
// CHECK: [[rate]] = NewClosure {{*}}function=
// CHECK: [[count]] = NewClosure {{*}}function=
// CHECK: = DirectEval {{*}}[[total]], [[rate]], [[count]]{{*}}evalScope=
// CHECK: DefineMethod

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-LABEL: function {{*}}name="define"
// ENVIRONMENTS-NOT: PutEnvironmentField
// ENVIRONMENTS-LABEL: function {{*}}kind=BaseConstructor

export let late;

export function define(turn) {
  return class {
    [eval("(late = entry => entry.#total(), 'first')")]() {
      return turn;
    }
    #total() {
      return turn;
    }
    get #rate() {
      return turn;
    }
    static #count() {
      return turn;
    }
  };
}
