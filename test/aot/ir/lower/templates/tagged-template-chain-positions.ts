// RUN: lower
// CHECK-LABEL: function {{*}}name="chain"
// CHECK: [[first]] = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @1745
// CHECK: [[made]] = Call {{*}}, [[first]] calleeName="tag"{{*}} @1742
// CHECK: [[second]] = NewTemplateObject templateStrings=[{cooked="b" raw="b"}] @1748
// CHECK: [[next]] = Call [[made]], {{*}}, [[second]]{{*}} @1742
// CHECK: [[third]] = NewTemplateObject templateStrings=[{cooked="c" raw="c"}] @1751
// CHECK: = Call [[next]], {{*}}, [[third]]{{*}} @1742
// CHECK-LABEL: function {{*}}name="equalStrings"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @1805
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @1808
// CHECK-LABEL: function {{*}}name="member"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @1856
// CHECK: = Call {{*}}calleeName="o.tag"{{*}} @1853
// CHECK: = NewTemplateObject templateStrings=[{cooked="b" raw="b"}] @1859
// CHECK-LABEL: function {{*}}name="spaced"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @1907
// CHECK: = NewTemplateObject templateStrings=[{cooked="b" raw="b"}] @1925
// CHECK: = NewTemplateObject templateStrings=[{cooked="c" raw="c"}] @1933
// CHECK-LABEL: function {{*}}name="substitutions"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}, {cooked="b" raw="b"}] @1996
// CHECK: = NewTemplateObject templateStrings=[{cooked="c" raw="c"}, {cooked="d" raw="d"}] @2004

// RUN(START): lower
// START-LABEL: function {{*}}name="chain"
// START-NOT: NewTemplateObject {{*}} @1742
// START-LABEL: function {{*}}name="member"
// START-NOT: NewTemplateObject {{*}} @1851
// START-NOT: NewTemplateObject {{*}} @1853

export function chain(tag: any) {
  tag`a``b``c`;
}

export function equalStrings(tag: any) {
  tag`a``a`;
}

export function member(o: any) {
  o.tag`a``b`;
}

export function spaced(tag: any) {
  tag`a` /* between */ `b`
    `c`;
}

export function substitutions(tag: any, x: any) {
  tag`a${x}b``c${x}d`;
}
