// As a-timer-that-a-function-of-the-program-hands-on: by the DOM's library a timer is a number, and a number may be reckoned with. The error would name nothing at all:
// "The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type."
export {};
function ring(): void {
  console.log("rang");
}
const id = setTimeout(ring, 1);
const ids = [setTimeout(ring, 2), setTimeout(ring, 3)];
ids.sort((a, b) => a - b);
console.log(typeof (id * 1), typeof (id % 8), typeof -id, ids.length);
