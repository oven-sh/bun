// A list that a loop appends to, beside two stores into views: the typed copy of the loop bore the literal again, and what stands behind the loop named that one. The build ended.
const view = new Uint8Array(8);
const words = new Uint16Array(view.buffer);
const own = new Uint16Array(8);
function grown(n: number): string { const some = [n]; for (let i = 0; i < 4; i++) { view[i] = some.length; some.push(view[i] + i); words[1] = 3; } return some.join() + ":" + some.length; }
function beside(n: number, turns: number): string { const some = [n]; for (let i = 0; i < turns; i++) { own[1] = 3; view[i] = some.length; some.push(view[i] + i); } return some.join() + ":" + some.length; }
function counted(n: number): number { const some = [n, n + 1]; for (let i = 0; i < 4; i++) { view[i] = some.length; some.push(view[i]); view[1] = 3; } return some.length; }
for (let n = 0; n < 4; n++) console.log(grown(n), beside(n, n * 2), counted(n), view.join(), words.join());
export {};
