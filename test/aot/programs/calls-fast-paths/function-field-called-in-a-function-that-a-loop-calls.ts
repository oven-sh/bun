// A field of a class holds one arrow function and is called in a function that has no loop and is called in one. The test of the byte is no level of inlining, so the function is copied in; and its `this` is the receiver, so the field is not read and the closure, which is made lazily, is never made.
// IR= 4 kernel IsClassObjectUnmodified
// IR= 0 kernel CallDirect
// IR= 0 kernel GetCapture
// IR= 4 kernel GetById v[0-9]+ "add"
class Context {
  count = 0;
  add = (by: number): number => {
    this.count += by;
    return this.count;
  };
}
let context: Context = new Context();
let total = 0;
let isNeverThrown = 0;
if (Date.now() < 0) isNeverThrown = 1;

function kernel(): void {
  try {
    if (isNeverThrown > 0) throw isNeverThrown;
  } catch {
    return;
  }
  total += context.add(1);
  total += context.add(2);
  total += context.add(3);
  total += context.add(4);
}

const rounds = Date.now() > 0 ? 1000 : -1;
for (let round = 0; round < rounds; round++) {
  kernel();
  if (rounds < 0) kernel();
}
console.log(total);
