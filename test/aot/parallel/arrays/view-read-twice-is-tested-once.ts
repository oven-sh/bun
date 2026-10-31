// IRT= 1 partAndOffset IsPristine
// IRT= 2 changedInBetween IsPristine
// IRT= 0 eitherView IsPristine
// IRT= 1 eitherViewChanged IsPristine
const print = (s: string) => console.log(s);
type Change = (bytes: Uint8Array) => void;
export function partAndOffset(bytes: Uint8Array): number { return bytes.subarray(1).length + bytes.byteOffset; }
export function changedInBetween(bytes: Uint8Array, change: Change): number {
    const part = bytes.subarray(1).length;
    change(bytes);
    return part + bytes.byteOffset;
}
export function eitherView(buffer: ArrayBuffer, whole: boolean): number {
    const view = whole ? new Uint8Array(buffer) : new Uint8Array(buffer, 2);
    return view.length * 10 + view.byteOffset;
}
export function eitherViewChanged(buffer: ArrayBuffer, whole: boolean, change: Change): number {
    const view = whole ? new Uint8Array(buffer) : new Uint8Array(buffer, 2);
    change(view);
    return view.length * 10 + view.byteOffset;
}

class Odd extends Uint8Array {
    get byteOffset(): number { return 100; }
    subarray(): Uint8Array<ArrayBuffer> { return new Uint8Array(50); }
}
const changes: Change[] = [
    () => {},
    bytes => { Object.defineProperty(bytes, "byteOffset", { value: 1000 }); },
    bytes => { Object.defineProperty(bytes, "length", { value: 3000 }); },
    bytes => { Object.setPrototypeOf(bytes, { __proto__: Uint8Array.prototype, get byteOffset() { return 2000; }, get length() { return 4000; } }); },
];
const buffer = new ArrayBuffer(8);
for (let round = 0; round < 3; round++) {
    const own = new Uint8Array(buffer, 2);
    changes[1](own);
    const below = new Uint8Array(buffer, 2);
    changes[3](below);
    print([new Uint8Array(buffer, round), new Odd(buffer, 1), own, below].map(partAndOffset).join(" "));
    print(changes.map(change => changedInBetween(new Uint8Array(buffer, round), change)).join(" "));
    print(eitherView(buffer, round === 1) + " " + changes.map(change => eitherViewChanged(buffer, round === 1, change)).join(" "));
}
(globalThis as any).kept = [partAndOffset, changedInBetween, eitherView, eitherViewChanged];
