// Views of evaluated text keep their elements when names are added.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const add = n => Array.from({ length: n }, (_, i) => `o.p${i} = i + ${i};`).join(" ");
const made = new Function(hidden(`const f5 = (o, i) => { ${add(5)} return o; }, f9 = (o, i) => { ${add(9)} return o; }, f17 = (o, i) => { ${add(17)} return o; }; return [f5, f9, f17];`))();
const makers = [() => ({}), () => [], () => [1, 2], () => new Map(), () => new Set([1]), () => new Uint8Array([1, 2, 3, 4]), () => new Float64Array([1.5, 2.5]), () => new ArrayBuffer(8), () => new Date(0), () => /p/, () => new Error("e"), () => function () { }, () => Promise.resolve(), () => new String("s"), () => new Number(1), () => new WeakMap(), () => Object.create(null)];
const lines = [];
for (let turn = 0; turn < 3; turn++) for (const [m, make] of makers.entries()) for (const f of made) { const o = f(make(), turn); f(o, turn + 1); lines.push(m + " " + [o.length, o[0]].join("|") + " " + Object.keys(o).filter(k => k[0] === "p").map(k => o[k]).join()); if (turn === 1 && !m) Bun.gc(true); }
let hash = 5381; for (const l of lines) for (let k = 0; k < l.length; k++) hash = (hash * 33 + l.charCodeAt(k)) | 0;
console.log(lines.length, hash); for (let k = 0; k < lines.length; k += 13) console.log(k, lines[k]);
