// RUN: link
// CHECK-COUNT-2: declared={type=builtin(ParseFloat) flags=[IsExpected]}
// CHECK-NOT: builtin(NumberParseFloat)

export const first = Number.parseFloat;
export const second = parseFloat;
