// A method of a literal and an arrow function that read a typed parameter of the function around them. The compiler tests the captured value at the head of each,
// and nothing but numbers ever arrives, so the version for other values is never entered. The build stopped on the call of that version.
interface Lock {
  [Symbol.dispose](): void;
  id: number;
}

let log = "";

function lock(id: number): Lock {
  return {
    id,
    [Symbol.dispose]() {
      log += "d" + id;
    },
  };
}

{
  using first = lock(1);
  using second = lock(2);
  log += "b" + first.id + second.id;
}
console.log(log);

function show(value: number): string {
  return "<" + value + ">";
}

function addAndShow(offset: number) {
  return (key: string, value: unknown) => (typeof value === "number" ? show(value + offset) : value);
}

console.log(JSON.stringify({ a: 1, b: [2, 3], c: "text" }, addAndShow(10)));
