const memory = new WebAssembly.Memory({ initial: 1 });
const size: number = memory.buffer.byteLength;
const pair = new DataView(memory.buffer, size - 2, 2);
pair.setUint8(0, 1);
pair.setUint8(1, 4);

function turnsOfPair(view: DataView, seen: Int32Array, turns: number): number {
    for (let turn = 0; turn < turns; turn++) {
        if ((view.getUint8(0) & 3) !== 1 || (view.getUint8(1) & 5) !== 4)
            throw new RangeError("not marked within " + turns + " turns of " + seen.length);
        seen[0]++;
    }
    return seen[0];
}

function turnsOfPairBackward(view: DataView, seen: Int32Array, turns: number): number {
    for (let turn = 0; turn < turns; turn++) {
        if ((view.getUint8(1) & 5) !== 4 || (view.getUint8(0) & 3) !== 1)
            throw new RangeError("not marked within " + turns + " turns of " + seen.length);
        seen[0]++;
        seen[1] = turn;
    }
    return seen[0] * 100 + seen[1];
}

console.log(turnsOfPair(pair, new Int32Array(2), Number("9")), turnsOfPairBackward(pair, new Int32Array(2), Number("9")));
