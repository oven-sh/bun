// A loop stores to every element of a view, for views of 0 to 40 elements that lie at the head of one buffer of 64: nothing behind the view is touched.
function fill(view: Uint8Array, value: number): void {
  for (let i = 0; i < view.length; i++) view[i] = value;
}
const whole = new Uint8Array(64);
const said: string[] = [];
for (let length = 0; length <= 40; length++) {
  whole.fill(0);
  fill(whole.subarray(0, length), 7);
  said.push(String(whole.lastIndexOf(7)));
}
console.log(said.join());
