// Performance.prototype.now is replaced, and performance.now() calls the replacement. The function that was there comes back, and the call reads the clock again.
// A property of performance itself hides the one of the prototype until it is deleted.
const original = Performance.prototype.now;
function early() {
  return -1;
}
const read = () => performance.now();
console.log(read() > 0);
Performance.prototype.now = early;
console.log(read(), performance.now === early, Object.hasOwn(performance, "now"));
Performance.prototype.now = original;
console.log(read() > 0, performance.now === original);
Object.defineProperty(performance, "now", { value: early, writable: true, configurable: true });
console.log(read(), Object.hasOwn(performance, "now"), Performance.prototype.now === original);
console.log(delete performance.now, read() > 0, Object.hasOwn(performance, "now"));
