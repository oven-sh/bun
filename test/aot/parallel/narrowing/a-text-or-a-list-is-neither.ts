// a parameter that is written as a text or a list of texts is handed a subclass of Array, a Proxy of a list, an array-like, a rope, a 16-bit text and nothing at all: on the side where the test for a list fails the value need be no text
function size(x: string | string[]): number {
  return x.length * x.length;
}

class Stack extends Array<string> {
  get top() {
    return this[this.length - 1];
  }
}

function deed(turn: number): string | string[] {
  let rope = "";
  for (let i = 0; i < 5; i++) rope += "ab";
  const hostile: unknown[] = [Stack.from(["a", "b", "c"]), new Proxy(["a", "b"], {}), { length: 4 }, rope, "Āā", new String("abc"), undefined, null, 7];
  return hostile[turn % 9] as string | string[];
}

function tell(x: string | string[]): string {
  try {
    return String(size(x));
  } catch (error) {
    return (error as Error).name;
  }
}

console.log(tell("abc"), tell(["a", "b"]), tell(""), tell([]));
let seen = "";
for (let i = 0; i < 300; i++) seen = tell(i % 2 ? "abc" : ["a", "b"]);
console.log(seen);
for (let i = 0; i < 9; i++) console.log(tell(deed(i)));
console.log(tell("abc"), tell(["a", "b"]));
