// RUN: lower
// CHECK-NOT: SetFunctionName
// CHECK-NOT: function {{*}}name=

// RUN(MADE): lower
// MADE-COUNT-7: NewClosure

export const variable = (0, function () {});

export const object = { property: (0, () => {}) };

export let stored;
stored = (0, class {});

export const { pattern = (0, function () {}) } = {};

export const holder = (0, class {
  static field = (0, function () {});
  field = (0, () => {});
});

export const called = (0, (parameter = (0, function () {})) => parameter);
