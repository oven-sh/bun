const quietNaNBits = 0x7ff8000000000000n;

export function bitsOfDouble(value: number): bigint {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  return Number.isNaN(value) ? quietNaNBits : bytes.getBigUint64(0);
}
