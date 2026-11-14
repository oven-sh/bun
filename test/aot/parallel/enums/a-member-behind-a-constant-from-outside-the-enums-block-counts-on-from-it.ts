// `bun run` writes a constant from outside the namespace or the function of an enum in place, so the member behind it counts on from that number; tsc and `bun check` give it that value as its type.
// `bun build` without --minify-syntax leaves the constant to the run time and the member behind has no value. An executable held `undefined` there under the literal type 101.
const BASE = 100;
const SHIFT = 4;
namespace Http {
  export enum Code {
    Ok = BASE,
    Fail,
    Gone = Fail + 1,
  }
  export enum Bit {
    Low = 1 << SHIFT,
    Next,
  }
  export enum Other {
    First = Code.Fail,
    Second,
  }
}
function table(): number[] {
  enum Row {
    A = BASE,
    B,
    C,
  }
  return [Row.A, Row.B, Row.C, Row.A + Row.B];
}
function name(code: Http.Code): string {
  switch (code) {
    case Http.Code.Ok:
      return "ok";
    case Http.Code.Fail:
      return "fail";
    case Http.Code.Gone:
      return "gone";
  }
}
const fail: Http.Code.Fail = Http.Code.Fail;
const names: Record<number, string> = { [Http.Bit.Low]: "low", [Http.Bit.Next]: "next" };
console.log(Http.Code.Ok, Http.Code.Fail, Http.Code.Gone, Http.Code[101], Object.keys(Http.Code).join());
console.log(table().join(), name(101), fail.toFixed(1), JSON.stringify(names), Http.Other.First, Http.Other.Second);
export {};
