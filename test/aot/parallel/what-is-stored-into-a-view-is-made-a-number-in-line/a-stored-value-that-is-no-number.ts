let runs = 0; const odd: any = { valueOf() { runs++; return 300; } };
function copy(out: Uint8Array, from: any[], view: Uint8Array): string { for (let i = 0; i < out.length; i++) out[i] = i === 2 ? from[i] : view[i]; return out.join() + " " + runs; }
const view = Uint8Array.of(1, 2, 3, 4); let s = ""; for (let r = 0; r < 200; r++) s = copy(new Uint8Array(5), [0, 0, 7, 0], view);
console.log(s, copy(new Uint8Array(5), [0, 0, odd, 0], view));
