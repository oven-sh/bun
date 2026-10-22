// A field of a class holds one arrow function and is called in a function that has no loop and is called in one. The function is copied in; and its `this` is the receiver, so the field is not read and the closure, which is created lazily, is never created.
// IR= 0 kernel IsClosureOf
// IR= 0 kernel CallDirect
// IR= 0 kernel GetCapture
// IR= 0 kernel PropGet v[0-9]+ name="add"(?!.* isFallback)
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
// Called once outside any loop too: top-level code that runs once takes nothing in, so the function keeps a body for the expectations to look at.
kernel();
console.log(total);
