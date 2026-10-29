// RUN: link
// CHECK: expectedresult [[expected]] type=L{{*}} layouts=[L
// CHECK: layout L
// CHECK: function {{*}}name="annotated"
// CHECK: = Call {{*}}expectedResult=[[expected]]
// CHECK: Return

interface Point {
  x: number;
}

export function annotated(text: string) {
  const parse: <T>(text: string) => T = JSON.parse;
  return parse<Point>(text);
}
