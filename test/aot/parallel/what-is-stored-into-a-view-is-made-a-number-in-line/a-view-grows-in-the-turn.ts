const shared: any = new (SharedArrayBuffer as any)(4, { maxByteLength: 16 }), all = new Uint8Array(shared), part = new Uint8Array(shared, 1), sub = all.subarray(2);
function sum(view: Uint8Array, at: number): string { let turns = 0, total = 0; for (let i = 0; i < view.length && turns < 40; i++) { total += view[i] + 1; if (i === at) shared.grow(shared.byteLength + 4); turns++; } return turns + " " + total + " " + view.length; }
console.log(sum(new Uint8Array(3), -1), sum(all, 2), sum(part, 0), sum(sub, 0));
// 3 3 3 8 8 8 11 11 11 14 14 14   (the last three: run plain first, they rest on subarray following the length)
