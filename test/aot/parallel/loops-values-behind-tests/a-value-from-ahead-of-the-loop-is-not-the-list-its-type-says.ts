// `[...source]` in every turn of a loop, where `source` was made ahead of the loop and its type says that it is a list
// of numbers. It comes out of JSON.parse, so it may be a list of whole numbers, of fractions, of anything, a text, an
// object, a number or null. In one loop the list gets a way of its own to be walked in the middle, and loses it again.
function parsed(text: string): number[] {
  return JSON.parse(text);
}
const whole = parsed("[1,2,3,4,5,6,7,8]");
const fractions = parsed("[1.5,2.5,3.5,4.5]");
const mixed = parsed('[1,"two",null,4.5,{"five":5},[6]]');
const walked = parsed("[1,2,3,4,5,6,7,8]");
const empty = parsed("[]");
const text = parsed('"abcd"');
const record = parsed('{"0":1,"length":1}');
const count = parsed("12");
const nothing = parsed("null");

function show(value: unknown): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
function copies(source: number[], turns: number): string {
  let all = "";
  let length = 0;
  for (let i = 0; i < turns; i++) {
    const copy = [...source];
    length += copy.length;
    all += show(copy[i & 3] ?? 0);
  }
  return `${length} ${all}`;
}
function attempt(name: string, source: number[]) {
  try {
    console.log(name, copies(source, 6));
  } catch (error) {
    console.log(name, error instanceof TypeError ? "TypeError" : String(error));
  }
}

function sumOfWhole(turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const copy = [...whole];
    sum = (sum + (copy[i & 3] ?? 0) + (copy[2] ?? 0)) | 0;
  }
  return sum;
}
function sumOfText(turns: number): string {
  let sum = "";
  for (let i = 0; i < turns; i++) {
    const copy = [...text];
    sum += copy[i & 3] ?? 0;
  }
  return sum;
}
function sumWhileTheWalkChanges(turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (i === 5)
      (walked as any)[Symbol.iterator] = function* (this: number[]) {
        yield this.length;
      };
    if (i === 8) delete (walked as any)[Symbol.iterator];
    const copy = [...walked];
    sum = sum * 3 + copy.length + (copy[0] ?? 0);
  }
  return sum;
}

attempt("whole", whole);
attempt("fractions", fractions);
attempt("mixed", mixed);
attempt("empty", empty);
attempt("text", text);
attempt("record", record);
attempt("count", count);
attempt("nothing", nothing);
console.log(sumOfWhole(10000), sumOfText(9), sumWhileTheWalkChanges(12));
