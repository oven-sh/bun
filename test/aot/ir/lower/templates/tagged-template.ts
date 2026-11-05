// RUN: lower
// CHECK-LABEL: function {{*}}name="invalidEscape"
// CHECK: = NewTemplateObject templateStrings=[{raw="\\unicode"}]
// CHECK-LABEL: function {{*}}name="member"
// CHECK: [[read]] = PropGet [[o]] key="tag"
// CHECK-NEXT: [[function]] = Convert [[read]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[memberStrings]] = NewTemplateObject templateStrings=[{cooked="a" raw="a"}]
// CHECK-NEXT: = Call [[function]], [[o]], [[memberStrings]] calleeKey="tag" calleeName="o.tag"
// CHECK-LABEL: function {{*}}name="plain"
// CHECK-NEXT: ([[tag]]: {{*}}, [[x]]:
// CHECK: [[convertedTag]] = Convert [[tag]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[strings]] = NewTemplateObject templateStrings=[{cooked="a" raw="a"}, {cooked="b" raw="b"}]
// CHECK-NEXT: = Call [[convertedTag]], -, [[strings]], [[x]] calleeName="tag"

// RUN(NOWHERE): lower
// NOWHERE-NOT: ToString
// NOWHERE-NOT: Strcat
// NOWHERE-NOT: ModuleVariable

export function invalidEscape(tag: any) {
  return tag`\unicode`;
}

export function member(o: any) {
  return o.tag`a`;
}

export function plain(tag: any, x: any) {
  return tag`a${x}b`;
}
