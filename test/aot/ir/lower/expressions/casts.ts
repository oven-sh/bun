// RUN: lower
// CHECK-LABEL: function {{*}}name="angle"
// CHECK: b0([[x]]: anything):
// CHECK: [[angled]] = Convert [[x]] declared={type=undefined|null|string site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: Return [[angled]]
// CHECK-LABEL: function {{*}}name="asAny"
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="asString"
// CHECK: [[asserted]] = Convert [[x]] declared={type=undefined|null|string site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: Return [[asserted]]
// CHECK-LABEL: function {{*}}name="instantiated"
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="nonNull"
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="satisfied"
// CHECK-NOT: Convert

export function angle(x: unknown): unknown {
  return <string>x;
}

export function asAny(x: unknown): unknown {
  return x as any;
}

export function asString(x: unknown): unknown {
  return x as string;
}

export function instantiated(f: <T>(value: T) => T): unknown {
  return f<number>;
}

export function nonNull(x: unknown): unknown {
  return x!;
}

export function satisfied(x: unknown): unknown {
  return x satisfies unknown;
}
