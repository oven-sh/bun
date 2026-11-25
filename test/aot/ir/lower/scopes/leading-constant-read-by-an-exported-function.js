// RUN(NAME): lower
// NAME-LABEL: function {{*}}name="readLimit"
// NAME-NOT: Return
// NAME: = CheckInitialized {{*}}name="limit"

// RUN(TYPE): lower
// TYPE-LABEL: function {{*}}name="readType"
// TYPE-NOT: Return
// TYPE: = CheckInitialized {{*}}name="label"

// RUN(SUM): lower
// SUM-LABEL: function {{*}}name="readDoubled"
// SUM-NOT: Return
// SUM: = CheckInitialized {{*}}name="doubled"

// A file that imports this one in a cycle may call these before the declarations have run, so each read tests its constant, under `typeof` too. `bun run` prints 5, "string" and 11 in place of them.
const limit = 5;
const label = "text";
const doubled = 5 * 2;

export function readLimit() {
  return limit;
}

export function readType() {
  return typeof label;
}

export function readDoubled() {
  return doubled + 1;
}
