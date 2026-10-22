// Callbacks handed over: setTimeout, setInterval and setImmediate call back with their extra arguments and queueMicrotask with none, so a number parameter gets a string, an object or undefined; direct calls pass numbers.
let total = 0;

function add(a: number, b: number): void {
  total += typeof a === "number" ? a : typeof a === "string" ? 1000 : a === undefined ? 10000 : 100000;
  total += typeof b === "number" ? b : typeof b === "string" ? 1000000 : b === undefined ? 10000000 : 100000000;
}

add(1, 2);
const loose: any = add;
setTimeout(add, 1, 3, 4);
setTimeout(loose, 1, "three");
setTimeout(loose, 1, {}, []);
setTimeout(loose, 1);
setImmediate(loose, "x", "y");
queueMicrotask(loose);
let rounds = 0;
const interval = setInterval(
  (a: number, b: number) => {
    add(a, b);
    if (++rounds < 2) return;
    clearInterval(interval);
    console.log(total);
  },
  5,
  5,
  "five" as any,
);
