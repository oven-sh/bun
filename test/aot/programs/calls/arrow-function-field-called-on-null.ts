// The field is not read, and the call on null or undefined still throws a TypeError.
class Context {
  count = 0;
  add = (by: number): number => {
    this.count += by;
    return this.count;
  };
}
const contexts: Context[] = [new Context(), new Context(), null!, undefined!];

function sum(context: Context): number {
  let total = 0;
  for (let i = 0; i < 100; i++) total += context.add(1);
  return total;
}

for (const context of contexts) {
  try {
    console.log(sum(context));
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
