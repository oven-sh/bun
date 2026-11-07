function makeTable(seed: number): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ seed : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}
class Base {
  constructor() {
    this.begin();
  }
  begin(): void {}
}
class Sum extends Base {
  private readonly table: Uint32Array;
  private state = -1;
  early = "";
  constructor(seed: number) {
    super();
    this.table = makeTable(seed);
  }
  begin(): void {
    try {
      this.early = String(this.take(1));
    } catch (error) {
      console.log((error as Error).constructor.name);
    }
  }
  take(byte: number): number {
    this.state = this.table[(this.state ^ byte) & 255]! ^ (this.state >>> 8);
    return this.state;
  }
}
const sum = new Sum(0xedb88320);
for (const byte of [104, 101, 108, 108, 111]) sum.take(byte);
console.log((sum.take(0) ^ -1) >>> 0, sum.early);
