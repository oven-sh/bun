// A view over a buffer is a new object, so its methods need no test of it; its bytes are the buffer's, so every other view sees what is stored.
// IR= 0 lengthsOfNewViews IsPristine
// IR= 1 lengthsOfGivenView IsPristine
// IR= 1 storedThroughViewNobodyReads PutTypedArrayElement
// IR= 2 storedThroughOtherView GetTypedArrayElement
const print = (s: string) => console.log(s);
export function lengthsOfNewViews(buffer: ArrayBuffer): number {
    const bytes = new Uint8Array(buffer, 1);
    const part = bytes.subarray(1, 4);
    const view = new DataView(buffer, 2);
    return bytes.length * 10000 + part.length * 1000 + part.byteOffset * 100 + view.byteLength * 10 + part.subarray(1).length;
}
export function lengthsOfGivenView(bytes: Uint8Array): number { return bytes.subarray(1).length + bytes.byteOffset; }
export function storedThroughViewNobodyReads(buffer: ArrayBuffer, value: number): void { const bytes = new Uint8Array(buffer); bytes[0] = value; }
export function storedThroughOtherView(buffer: ArrayBuffer, value: number): number {
    const first = new Uint8Array(buffer), second = new Uint8Array(buffer);
    const before = first[1];
    second[1] = value;
    return before * 1000 + first[1];
}
export function storedThroughPart(buffer: ArrayBuffer, value: number): number {
    const bytes = new Uint8Array(buffer), part = bytes.subarray(2);
    const before = bytes[2];
    part[0] = value;
    return before * 1000 + bytes[2];
}
export function storedThroughDataView(buffer: ArrayBuffer, value: number): number {
    const words = new Uint16Array(buffer), view = new DataView(buffer);
    const before = words[2];
    view.setUint16(4, value, true);
    return before * 100000 + words[2];
}
export function changedView(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer) as Uint8Array & { subarray: unknown; note?: string };
    const part = bytes.subarray(1).length;
    bytes.note = "own";
    Object.defineProperty(bytes, "subarray", { value: () => ({ length: "mine" }) });
    return part + " " + (bytes.subarray as (n: number) => { length: unknown })(1).length + " " + bytes.note;
}
class Bytes extends Uint8Array {
    static get [Symbol.species]() { return Uint16Array; }
    get length(): number { return -1; }
}
export function partOfSubclass(buffer: ArrayBuffer): string {
    const bytes = new Bytes(buffer);
    const part = bytes.subarray(2, 4);
    return bytes.length + " " + part.constructor.name + " " + part.length + " " + (part instanceof Bytes);
}
export function outOfRange(buffer: ArrayBuffer, offset: number): string {
    try { new Uint8Array(buffer, offset); new DataView(buffer, offset); return "fits"; } catch (e) { return (e as Error).name; }
}

const buffer = new ArrayBuffer(8);
print(String(lengthsOfNewViews(buffer)) + " " + String(lengthsOfGivenView(new Uint8Array(buffer, 3))));
storedThroughViewNobodyReads(buffer, 7);
print(new Uint8Array(buffer).join(","));
print(String(storedThroughOtherView(buffer, 9)) + " " + String(storedThroughPart(buffer, 11)) + " " + String(storedThroughDataView(buffer, 513)));
print(new Uint8Array(buffer).join(","));
print(changedView(buffer) + " | " + partOfSubclass(buffer));
print(outOfRange(buffer, 8) + " " + outOfRange(buffer, 9) + " " + outOfRange(buffer, -1));
{
    const shared = new SharedArrayBuffer(4), resizable = new ArrayBuffer(4, { maxByteLength: 8 });
    const tracking = new Uint8Array(resizable), fixed = new Uint8Array(resizable, 0, 4), part = tracking.subarray(1);
    resizable.resize(8);
    print(tracking.length + " " + fixed.length + " " + part.length + " " + lengthsOfNewViews(resizable) + " " + storedThroughOtherView(shared as unknown as ArrayBuffer, 5));
    resizable.resize(2);
    print(tracking.length + " " + fixed.length + " " + part.length + " " + String(fixed[0]));
}
(globalThis as any).kept = [lengthsOfNewViews, lengthsOfGivenView, storedThroughViewNobodyReads, storedThroughOtherView, storedThroughPart, storedThroughDataView, changedView, partOfSubclass, outOfRange];
