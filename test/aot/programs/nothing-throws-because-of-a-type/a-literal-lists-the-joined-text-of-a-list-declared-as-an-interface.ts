// Declares the list that Object.keys() returns as an interface, joins it through `any` into a variable declared as a number, and lists the variable in an object literal.
// A function that nobody calls makes the only object of the interface.
interface Thenable {
  then: bigint;
}
class Empty {}
const keys: Thenable = Object.keys(new Empty()) as unknown as Thenable;
const joined: number = (keys as any).join("+");
try {
  const tagged = { kind: null, value: joined };
  console.log(typeof tagged.value, JSON.stringify(tagged));
} catch (error) {
  console.log("caught", error);
}
function outer(): void {
  function inner(): Thenable {
    return { then: 1n };
  }
}
outer();
