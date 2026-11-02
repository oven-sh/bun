// Nothing of these objects escapes, so flow sees every store to their enum fields, and the stores bring numbers that are no int32. What flow proves of such a field and its slot must agree:
// each number is read back as it was stored, from the object itself and from its copies by spread, rest and Object.assign.
declare const console: { log(...values: unknown[]): void };
enum Color { Red, Green, Blue }
class Pixel { color: Color; bits: Color; name: string; constructor(color: Color, bits: Color) { this.color = color; this.bits = bits; this.name = "p"; } }
interface Cell { color: Color; bits: Color; name?: string }
function ofPixel(p: Pixel): string { return p.color + " " + p.bits; }
function ofCell(c: Cell): string { return c.color + " " + c.bits; }
function ofRest(c: { color: Color; bits: Color }): string { return c.color + " " + c.bits; }
const numbers: number[] = JSON.parse("[1, 2147483648, -2147483649, 0.5, -0, 2147483647, -2147483648]");
for (const n of numbers) {
    const p = new Pixel(n, n);
    const spread = { ...p };
    const { name, ...rest } = p;
    const cell: Cell = { color: n, bits: n };
    const cellSpread: Cell = { ...cell };
    const { name: unused, ...cellRest } = cell;
    const changed: Cell = { ...cell, bits: Color.Blue };
    const assigned: Cell = Object.assign({ color: Color.Red, bits: Color.Red }, cell);
    console.log(ofPixel(p), "|", ofCell(spread), "|", ofRest(rest), "|", ofCell(cell), "|", ofCell(cellSpread), "|", ofRest(cellRest), "|", ofCell(changed), "|", ofCell(assigned), name, unused);
}
