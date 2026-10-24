// The pairs whose build that knows more has more code than ../knowing-more-adds-no-code.test.ts allows today, each with what the build said when the line was written.
// They are listed as todo. A pair that has come within the bound is taken out of here, and from then on the test holds it there. `bun test --todo` says which have.

/** bytes of code of the program's own functions: less | more, and where the bytes stand */
export const knownToday: Readonly<Record<string, string>> = {
  "an-untyped-module-gets-types":
    "1,962 | 2,209: the tests at the entrance of the functions and their generic versions stand beside bodies that are no smaller for their types",
  "a-result-gets-a-type":
    "1,634 | 2,005: the generic versions of both functions grow, and a typed body stands beside the worker",
  "a-loop-over-typed-elements":
    "668 | 750: tests at the entrance (17 bytes) and a generic version (209) stand beside the typed body",
};
