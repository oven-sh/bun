// `list.push(a, ...other)`: the call stands in a small function that is copied in, under try and finally, in a loop that runs no turn, one turn and many, and in a closure made a turn.
const add = (out, first, source) => { out.push(first, ...source); };
function chain(layers) { const out = []; for (const layer of layers) { out.push(() => layer.name, ...layer.stack); } return out.map(it => (typeof it === "function" ? it() : it)).join(","); }
function copied(sources) { const out = []; for (const source of sources) add(out, sources.length, source); return JSON.stringify(out); }
function guarded(sources) { const out = []; for (const source of sources) { try { out.push("t", ...source); } finally { out.push("f"); } } return JSON.stringify(out); }
console.log(chain([]), "|", chain([{ name: "a", stack: [1, 2] }]), "|", chain([{ name: "a", stack: [] }, { name: "b", stack: ["x"] }, { name: "c", stack: [1, 2, 3] }]));
console.log(copied([]), copied([[1]]), copied([[1], [], [2, 3]]), guarded([]), guarded([[1], [2, 3]]));
let sum = 0; for (let turn = 0; turn < 2000; turn++) { const out = []; out.push(turn, ...[turn, turn + 1]); out.push(...out); sum += out.length + out[5]; } console.log(sum);
