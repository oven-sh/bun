// Operands that fit no overload behind an expected receiver.
type Reader = { readUInt8(at: unknown): unknown; subarray(from: unknown, to?: unknown): { length: number } };

function read(from: Buffer, at: unknown): unknown {
  try {
    return (from as unknown as Reader).readUInt8(at);
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).name;
  }
}

function part(from: Buffer, start: unknown, end: unknown): unknown {
  try {
    return (from as unknown as Reader).subarray(start, end).length;
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).name;
  }
}

const bytes = Buffer.from([11, 22, 33, 44]);
const withOwnMethod = Buffer.from([55, 66]);
(withOwnMethod as unknown as { readUInt8: unknown }).readUInt8 = function (this: Buffer, at: unknown) {
  return `own ${this.length} ${String(at)}`;
};
const impostor = {
  readUInt8(at: unknown) {
    return `impostor ${String(at)}`;
  },
  subarray(from: unknown, to: unknown) {
    return { length: `${String(from)}..${String(to)}`.length };
  },
} as unknown as Buffer;
let conversions = 0;
const counted = {
  valueOf() {
    conversions++;
    return 1;
  },
};

const receivers: Buffer[] = [bytes, bytes, withOwnMethod, impostor, bytes];
const positions: unknown[] = [0, 3, "1", undefined, null, 1.5, -1, 4, counted, 2n, true, Symbol.iterator, [2], {}];
const seen: string[] = [];
for (let round = 0; round < 3; round++) {
  for (const receiver of receivers) {
    for (const position of positions) seen.push(String(read(receiver, position)));
    for (const position of positions) {
      if (typeof position !== "symbol" && typeof position !== "bigint") seen.push(String(part(receiver, position, counted)));
    }
  }
}
console.log(seen.length, conversions);
console.log(seen.slice(0, 130).join(" | "));
console.log(read(null as unknown as Buffer, 0), read(undefined as unknown as Buffer, 0), read(7 as unknown as Buffer, 0));
