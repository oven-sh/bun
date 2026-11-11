// As a-timer-that-a-function-of-the-program-hands-on, out of a field without a written type.
export {};
function ring(): void {
  console.log("rang");
}
class Poller {
  timer = setTimeout(ring, 1);
}
const id: number = new Poller().timer;
console.log(typeof id);
