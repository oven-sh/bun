// A slice is made at its first use, inside a try. A call in front of that use throws, so the finally runs while the slice is not made yet; behind it the variable is built up as text.
// Flags: --aot-limit=MaxWarmCodeValues:1
class Box {
  constructor(public n: number, public next: null) {}
}
function opaqueText(x: string, y: number) {}
function fold(value: any) {
  switch (value) {
    default:
      return value;
  }
}
let throwsAt = -1;
function mayThrow(turn: number) {
  if (turn === throwsAt) throw new Error("thrown in turn " + turn);
}
function f4(a: number, b: number) {
  let v1: any = 0;
  let v3;
  let v8: any = new Box(a, null);
  let v9 = String();
  let v10: any;
  let v11 = String(b);
  let v12 = 0;
  let v13 = a;
  let v14;
  let v15;
  switch (v1) {
    case 0:
      let c1 = 3;
      do {
        v10 = v11.slice();
        try {
          mayThrow(c1);
          v1 = v10 < "k" ? v13 : length;
          v9 = v9 + 0;
        } finally {
          v15 = "a".slice();
        }
      } while (--c1);
      try {
        for (const each of []) opaqueText(v10, v12);
        v9 = v1 > 0 ? v10 : "z";
        try {
        } catch (thrown) {}
      } finally {
        switch (v1) {
          case 0:
            v8 = undefined;
        }
      }
      try {
        for (const each of [5]) v10 = `${v9.slice(0, 3)}\n`;
      } finally {
      }
  }
  return [fold(v3), typeof v8, v10, fold(v14), v15].join("|");
}
let last = "";
for (let i = 0; i < 400; i++) last = f4(i, i * 7);
console.log(JSON.stringify(last));
for (const at of [3, 2, 1]) {
  throwsAt = at;
  try {
    console.log(JSON.stringify(f4(5, 1234)));
  } catch (error) {
    console.log("caught: " + (error as Error).message);
  }
}
