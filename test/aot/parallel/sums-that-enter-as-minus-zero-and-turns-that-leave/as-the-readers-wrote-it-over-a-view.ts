function say(value: number): string { return Object.is(value, -0) ? "-0" : String(value); }
function whole(view: Uint8Array, start: number): number { let t = Math.floor(start); for (let i = 0; i < view.length; i++) { if (view[i] === 200) break; t += view[i]; } return t; }
function any(view: Uint8Array, start: number): number { let t = start; for (let i = 0; i < view.length; i++) { if (view[i] === 200) return t; t += view[i]; } return t; }
function once(length: number, at: number, start: number): void {
  const view = new Uint8Array(length);
  for (let i = 0; i < length; i++) view[i] = i === at ? 200 : 0;
  console.log(length, at, say(start), say(whole(view, start)), say(any(view, start)));
}
const lengths = [1, 7, 8, 9, 16, 17, 40];
const starts = [-0, 0, 5];
for (let k = 0; k < lengths.length; k++) { for (let s = 0; s < starts.length; s++) { once(lengths[k], 0, starts[s]); once(lengths[k], 1, starts[s]); } }
