// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: NewRegExp
// CHECK-LABEL: function {{*}}name="create"
// CHECK: = NewRegExp pattern="a+" regExpFlags=[Global, IgnoreCase]
// CHECK-LABEL: function {{*}}name="escaped"
// CHECK: = NewRegExp pattern="\\u00E9+"
// CHECK: = NewRegExp pattern="[\\u00E9-\\u00FC]"
// CHECK: = NewRegExp pattern="\\\\\\u00E9"
// CHECK: = NewRegExp pattern="\\\\\\u00E9"
// CHECK: = NewRegExp pattern="\\uD83D\\uDE00"
// CHECK: = NewRegExp pattern="(?<a>\\u00E9)"

export function create() {
  return /a+/gi;
}

// The pattern is what `bun run` prints for the literal: an escape for each non-ASCII character, and a backslash
// ahead of the character is the backslash of that escape.
export function escaped() {
  return [/\é+/, /[\é-\ü]/, /\\é/, /\\\é/, /\😀/, /(?<a>\é)/];
}
