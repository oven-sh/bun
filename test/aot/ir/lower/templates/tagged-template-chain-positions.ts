// RUN: lower
// CHECK-LABEL: function {{*}}name="chain"
// CHECK: [[first]] = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @1949
// CHECK: [[made]] = Call {{*}}, [[first]] calleeName="tag"{{*}} @1946
// CHECK: [[madeTag]] = Convert [[made]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: [[second]] = NewTemplateObject templateStrings=[{cooked="b" raw="b"}] @1952
// CHECK: [[next]] = Call [[madeTag]], {{*}}, [[second]]{{*}} @1946
// CHECK: [[nextTag]] = Convert [[next]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: [[third]] = NewTemplateObject templateStrings=[{cooked="c" raw="c"}] @1955
// CHECK: = Call [[nextTag]], {{*}}, [[third]]{{*}} @1946
// CHECK-LABEL: function {{*}}name="equalStrings"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @2009
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @2012
// CHECK-LABEL: function {{*}}name="member"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @2060
// CHECK: = Call {{*}}calleeName="tag"{{*}} @2057
// CHECK: = NewTemplateObject templateStrings=[{cooked="b" raw="b"}] @2063
// CHECK-LABEL: function {{*}}name="spaced"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}] @2111
// CHECK: = NewTemplateObject templateStrings=[{cooked="b" raw="b"}] @2129
// CHECK: = NewTemplateObject templateStrings=[{cooked="c" raw="c"}] @2137
// CHECK-LABEL: function {{*}}name="substitutions"
// CHECK: = NewTemplateObject templateStrings=[{cooked="a" raw="a"}, {cooked="b" raw="b"}] @2200
// CHECK: = NewTemplateObject templateStrings=[{cooked="c" raw="c"}, {cooked="d" raw="d"}] @2208

// RUN(START): lower
// START-LABEL: function {{*}}name="chain"
// START-NOT: NewTemplateObject {{*}} @1946
// START-LABEL: function {{*}}name="member"
// START-NOT: NewTemplateObject {{*}} @2055
// START-NOT: NewTemplateObject {{*}} @2057

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
