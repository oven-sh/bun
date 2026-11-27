// RUN: link
// CHECK: expectedresult [[parsed]] type=Array<undefined|null|L{{*}}> layouts=[L{{*}}] flags=[IsMadeByParser]
// CHECK: function {{*}}name="parsed"
// CHECK: = Call {{*}}expectedResult=[[parsed]]

// RUN(DECLARED): link
// DECLARED-NOT: expectedresult {{*}} type=L{{*}}flags=[IsMadeByParser]
// DECLARED: function {{*}}name="declared"
// DECLARED: = Call {{*}}expectedResult=

interface Row {
  id: number;
}

interface Sum {
  total: number;
}

declare function answer<T>(): T;

export function declared() {
  return answer<Sum>();
}

export function parsed(text: string) {
  const rows: Row[] = JSON.parse(text);
  return rows;
}
