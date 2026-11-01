// RUN: lower
// CHECK-LABEL: function {{*}}name="chain"
// CHECK: [[first]] = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @1951
// CHECK: [[made]] = Call {{*}}, [[first]] calleeName="tag"{{*}} @1948
// CHECK: [[madeTag]] = Convert [[made]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: [[second]] = NewTemplateObject templateStrings=[{cooked="b" raw="b"}] @1954
// CHECK: [[next]] = Call [[madeTag]], {{*}}, [[second]]{{*}} @1948
// CHECK: [[nextTag]] = Convert [[next]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: [[third]] = NewTemplateObject templateStrings=[{cooked="c" raw="c"}] @1957
// CHECK: = Call [[nextTag]], {{*}}, [[third]]{{*}} @1948
// CHECK-LABEL: function {{*}}name="equalStrings"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @2011
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @2014
// CHECK-LABEL: function {{*}}name="member"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @2062
// CHECK: = Call {{*}}calleeName="o.tag"{{*}} @2059
// CHECK: = NewTemplateObject templateStrings=[{cooked="b" raw="b"}] @2065
// CHECK-LABEL: function {{*}}name="spaced"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @2113
// CHECK: = NewTemplateObject templateStrings=[{cooked="b" raw="b"}] @2131
// CHECK: = NewTemplateObject templateStrings=[{cooked="c" raw="c"}] @2139
// CHECK-LABEL: function {{*}}name="substitutions"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}, {cooked="b" raw="b"}] @2202
// CHECK: = NewTemplateObject templateStrings=[{cooked="c" raw="c"}, {cooked="d" raw="d"}] @2210

// RUN(START): lower
// START-LABEL: function {{*}}name="chain"
// START-NOT: NewTemplateObject {{*}} @1948
// START-LABEL: function {{*}}name="member"
// START-NOT: NewTemplateObject {{*}} @2057
// START-NOT: NewTemplateObject {{*}} @2059

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
