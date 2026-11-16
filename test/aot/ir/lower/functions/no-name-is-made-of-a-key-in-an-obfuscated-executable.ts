// RUN: lower
// CHECK-COUNT-6: SetFunctionName

// An obfuscated executable shows no name of a function, also none that is made of a key while the program runs.
// RUN(HIDDEN): lower
// OPTIONS(HIDDEN): obfuscates
// HIDDEN: NewClosure
// HIDDEN-NOT: SetFunctionName

// --sourcemap=external without --obfuscate: what the program reads stays.
// RUN(KEPT): lower
// OPTIONS(KEPT): obfuscates keeps-names
// KEPT-COUNT-6: SetFunctionName

declare const text: string;
const mark = Symbol(text);

export class Keyed {
  [mark]() {}
  get [text]() {
    return 1;
  } // @ts-expect-error
  static accessor [text + "x"] = 2;
}

export const literal = { [mark]: () => {}, [text]: class {} };
