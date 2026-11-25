function mixed(i: number): (number | string)[] { return [i + 0.5, i]; }
function perhaps(i: number, o?: { x: number }): (number | undefined)[] { return [o?.x, i + 0.5]; }
function holes(i: number): (number | undefined)[] { return [i + 0.5, , i]; }
const a = mixed(1); a.push("text"); console.log(JSON.stringify(a));
console.log(JSON.stringify(perhaps(1)), JSON.stringify(perhaps(1, { x: 2.5 })), 0 in perhaps(1));
const h = holes(1); console.log(JSON.stringify(h), 1 in h, h.length, h[1]);
