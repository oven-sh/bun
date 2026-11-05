// RUN: lower
// CHECK-COUNT-6: SetFunctionName

// An obfuscated executable shows no name of a function, also none that is made of a key while the program runs.
// RUN(HIDDEN): lower
// OPTIONS(HIDDEN): obfuscates
// HIDDEN: NewClosure
// HIDDEN-NOT: SetFunctionName

declare const text: string;
const mark = Symbol(text);

export class Keyed {
  [mark]() {}
  get [text]() {
    return 1;
  }
  static accessor [text + "x"] = 2;
}

export const literal = { [mark]: () => {}, [text]: class {} };
