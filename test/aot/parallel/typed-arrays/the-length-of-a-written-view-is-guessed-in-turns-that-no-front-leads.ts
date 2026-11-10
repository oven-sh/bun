// STATISTIC: GuessesAtLengthsThatTakeInstancesBelow = 5
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: where the length is believed by the note the weaker test is asked again
// The index steps by what was read, or the bytes lie in a field that is read in the turn: no front leads such a loop, and each read of the length has a guess of its own. It takes a Buffer where Uint8Array is
// written, for the length alone. What has a length, a name or a prototype of its own, an heir, another view, a list and a text go the other way.
function scan(bytes: Uint8Array): number { let n = 0, i = 0; while (i < bytes.length) { const c = bytes[i++]!; if (c >= 0xc2 && i < bytes.length) { n += bytes[i++]! & 0x3f; continue; } n += c; } return n; }
class Reader {
  at = 0; bytes: Uint8Array;
  constructor(bytes: Uint8Array) { this.bytes = bytes; }
  sum(): number { let s = 0; for (this.at = 0; this.at < this.bytes.length; this.at++) s += this.bytes[this.at]!; return s; }
  swapped(other: Uint8Array): number { let s = 0; for (this.at = 0; this.at < this.bytes.length; this.at++) { s += this.bytes[this.at]!; if (this.at === 1) this.bytes = other; } return s; }
}
function laid(bytes: Uint8Array, at: number): number { let n = 0, i = 0; while (i < bytes.length) { if (i === at) Object.defineProperty(bytes, "length", { value: 2, configurable: true }); n += bytes.length * 10 + bytes[i]!; i += 1 + (n & 1); } return n; }
function named(bytes: Uint8Array): string { let n = 0, i = 0; while (i < bytes.length) { n += bytes[i]!; i += 1 + (n & 1); } return n + ":" + bytes.toString() + ":" + bytes.slice(1).constructor.name; }
class Short extends Uint8Array { get length(): number { return 1; } }
const given = (): any[] => [new Uint8Array([1, 200, 3, 4]), Buffer.from([1, 200, 3, 4]), Buffer.from("abéd"), Buffer.alloc(0), new Short([6, 7]), new Uint8ClampedArray([300, 2]), [8, 200, 9], "12", Object.defineProperty(Buffer.from([5, 6]), "length", { value: 1 }), Object.setPrototypeOf(Buffer.from([7, 8]), Uint8Array.prototype), Object.setPrototypeOf(new Uint8Array([7, 8, 9]), Buffer.prototype), Object.assign(Buffer.from([9, 9, 9]), { extra: 1 }), Buffer.from([1, 2, 3, 4, 5, 6]).subarray(2)];
const table: Record<string, (a: any) => unknown> = { scan, named, sum: a => new Reader(a).sum(), swapped: a => new Reader(a).swapped(Buffer.from([7, 8, 9])), swappedForPlain: a => new Reader(a).swapped(new Uint8Array([1])), laidAtOnce: a => laid(a, 0), laidLater: a => laid(a, 2) };
for (let turn = 0; turn < 3; turn++) for (const name of JSON.parse('["scan","named","sum","swapped","swappedForPlain","laidAtOnce","laidLater"]')) { const said: string[] = []; for (const a of given()) { try { said.push(String(table[name]!(a))); } catch (e) { said.push((e as Error).name); } } console.log(name, said.join(" ")); }
