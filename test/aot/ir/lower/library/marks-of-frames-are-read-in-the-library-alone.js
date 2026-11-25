// `("frames are native code");` and `("has no frames");` are marks in Bun's own modules: src/js/README.md. In a program the same texts are statements that do nothing.
// OPTIONS: builtin-modules
// RUN(LIBRARY): link
// LIBRARY: function {{*}}name="nextTick"{{*}}IsShownAsNativeCode
// RUN(PROGRAM): lower
// PROGRAM-NOT: IsShownAsNativeCode
// PROGRAM-NOT: IsHiddenInStackTraces

export function shown() {
  ("frames are native code");
  return 1;
}

export function listed() {
  ("has no frames");
  return 2;
}

process.nextTick(shown);
