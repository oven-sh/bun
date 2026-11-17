// Big integers of 64 bits are read out of views and kept, very many of them.
function read(count: number): string {
  const signed = new BigInt64Array(4), unsigned = new BigUint64Array(signed.buffer), window = new DataView(signed.buffer);
  signed[0] = -1n;
  signed[1] = 2n ** 62n;
  signed[2] = 0n;
  signed[3] = -(2n ** 63n);
  const kept: bigint[] = [];
  for (let turn = 0; turn < count; turn++) kept.push(signed[turn & 3], unsigned[turn & 3], window.getBigInt64((turn & 3) * 8, true), window.getBigUint64((turn & 3) * 8, false));
  let sum = 0n;
  for (const value of kept) sum += value;
  return kept.length + ":" + sum + ":" + kept.slice(-8).join();
}
console.log(read(4), read(30000));
