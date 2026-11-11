// A class of the program below JSCallback lays its own methods over those of bun:ffi: nothing is bound by the class of the cell.
import { JSCallback } from "bun:ffi";
class Loud extends JSCallback {
  close() {
    console.log("own close");
    super.close();
  }
  [Symbol.toPrimitive]() {
    return 7;
  }
}
function run(pick) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const made = pick(new Loud(() => 1, { returns: "i32" }));
  console.log(+made, typeof made.ptr, made instanceof Loud);
  made[Symbol.dispose]();
  made.close();
  console.log(String(made.ptr));
}
run(x => x);
