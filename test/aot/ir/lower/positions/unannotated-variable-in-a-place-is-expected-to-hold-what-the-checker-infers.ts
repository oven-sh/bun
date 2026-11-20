// RUN: link
// CHECK: layout [[pair]] {{*}}key="first"
// CHECK: variable {{*}}name="table" module=[[entry]] declared={type=undefined|null|absent|Int32Array flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK: variable {{*}}name="pair" module=[[entry]] declared={type=undefined|null|absent|[[pair]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK: variable {{*}}name="written" module=[[entry]] declared={type=undefined|null|absent|Int32Array flags=[OmitsNull, OmitsUndefined]}
// CHECK: variable {{*}}name="counted" module=[[entry]] declared={type=number|absent}

// Nobody wrote what `table` and `pair` hold, and other functions read them. What the checker infers goes out as what is expected there: each use tests what it reads. What is stored is stored as it is: unannotated-variable-is-untyped.ts.
// An annotation is declared as ever, and so is a variable that is stored to again.
class Pair {
  first = 1;
}

const table = Int32Array.from([1, 2, 3]);
const pair = new Pair();
const written: Int32Array = table;
let counted = table.length;

export function read(at: number) {
  counted = counted + 1;
  return table[at]! + pair.first + written.length;
}
