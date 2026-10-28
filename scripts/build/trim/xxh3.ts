const secret = Buffer.from(
  "b8fe6c3923a44bbe7c01812cf721ad1cded46de9839097db7240a4a4b7b3671fcb79e64eccc0e578825ad07dccff7221b8084674f743248ee03590e6813a264c" +
    "3c2852bb91c300cb88d0658b1b532ea371644897a20df94e3819ef46a9deacd8a8fa763fe39c343ff9dcbbc7c70b4f1d8a51e04bcdb45931c89f7ec9d9787364" +
    "eac5ac8334d3ebc3c581a0fffa1363eb170ddd51b7f0da49d316552629d4689e2b16be587d47a1fc8ff8b8d17ad031ce45cb3a8f95160428afd7fbcabb4b407e",
  "hex",
);
const mask = (1n << 64n) - 1n;
const prime32a = 0x9e3779b1n;
const prime32b = 0x85ebca77n;
const prime32c = 0xc2b2ae3dn;
const prime64a = 0x9e3779b185ebca87n;
const prime64b = 0xc2b2ae3d27d4eb4fn;
const prime64c = 0x165667b19e3779f9n;
const prime64d = 0x85ebca77c2b2ae63n;
const prime64e = 0x27d4eb2f165667c5n;
const primeMixA = 0x165667919e3779f9n;
const primeMixB = 0x9fb21c651e98df25n;
const read64 = (bytes: Buffer, at: number) => bytes.readBigUInt64LE(at);
const read32 = (bytes: Buffer, at: number) => BigInt(bytes.readUInt32LE(at));
const rotate = (value: bigint, by: bigint) => ((value << by) | (value >> (64n - by))) & mask;
const swap64 = (value: bigint) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes.readBigUInt64BE(0);
};
const foldedProduct = (a: bigint, b: bigint) => {
  const product = a * b;
  return (product & mask) ^ (product >> 64n);
};
const avalanche = (hash: bigint) => {
  hash ^= hash >> 37n;
  hash = (hash * primeMixA) & mask;
  return hash ^ (hash >> 32n);
};
const avalanche64 = (hash: bigint) => {
  hash ^= hash >> 33n;
  hash = (hash * prime64b) & mask;
  hash ^= hash >> 29n;
  hash = (hash * prime64c) & mask;
  return hash ^ (hash >> 32n);
};
const mix16 = (bytes: Buffer, at: number, secretAt: number) =>
  foldedProduct(read64(bytes, at) ^ read64(secret, secretAt), read64(bytes, at + 8) ^ read64(secret, secretAt + 8));

export function xxh3(bytes: Buffer): bigint {
  const length = bytes.length;
  const size = BigInt(length);
  if (length === 0) return avalanche64(read64(secret, 56) ^ read64(secret, 64));
  if (length <= 3) {
    const combined =
      (BigInt(bytes[0]!) << 16n) | (BigInt(bytes[length >> 1]!) << 24n) | BigInt(bytes[length - 1]!) | (size << 8n);
    return avalanche64(read32(secret, 0) ^ read32(secret, 4) ^ combined);
  }
  if (length <= 8) {
    const keyed = (read32(bytes, length - 4) + (read32(bytes, 0) << 32n)) ^ (read64(secret, 8) ^ read64(secret, 16));
    let hash = keyed ^ rotate(keyed, 49n) ^ rotate(keyed, 24n);
    hash = (hash * primeMixB) & mask;
    hash ^= (hash >> 35n) + size;
    hash = (hash * primeMixB) & mask;
    return hash ^ (hash >> 28n);
  }
  if (length <= 16) {
    const low = read64(bytes, 0) ^ (read64(secret, 24) ^ read64(secret, 32));
    const high = read64(bytes, length - 8) ^ (read64(secret, 40) ^ read64(secret, 48));
    return avalanche((size + swap64(low) + high + foldedProduct(low, high)) & mask);
  }
  if (length <= 128) {
    let sum = (size * prime64a) & mask;
    for (let round = (length - 1) >> 5; round >= 0; round--) {
      sum += mix16(bytes, 16 * round, 32 * round) + mix16(bytes, length - 16 * (round + 1), 32 * round + 16);
    }
    return avalanche(sum & mask);
  }
  if (length <= 240) {
    let sum = (size * prime64a) & mask;
    for (let round = 0; round < 8; round++) sum += mix16(bytes, 16 * round, 16 * round);
    sum = avalanche(sum & mask);
    for (let round = 8; round < length >> 4; round++) sum += mix16(bytes, 16 * round, 16 * (round - 8) + 3);
    return avalanche((sum + mix16(bytes, length - 16, 136 - 17)) & mask);
  }
  const lanes = [prime32c, prime64a, prime64b, prime64c, prime64d, prime32b, prime64e, prime32a];
  const accumulate = (at: number, secretAt: number) => {
    for (let lane = 0; lane < 8; lane++) {
      const value = read64(bytes, at + 8 * lane);
      const keyed = value ^ read64(secret, secretAt + 8 * lane);
      lanes[lane ^ 1] = (lanes[lane ^ 1]! + value) & mask;
      lanes[lane] = (lanes[lane]! + (keyed & 0xffffffffn) * (keyed >> 32n)) & mask;
    }
  };
  const stripesInABlock = (secret.length - 64) / 8;
  const block = 64 * stripesInABlock;
  const blocks = Math.floor((length - 1) / block);
  for (let index = 0; index < blocks; index++) {
    for (let stripe = 0; stripe < stripesInABlock; stripe++) accumulate(index * block + stripe * 64, stripe * 8);
    for (let lane = 0; lane < 8; lane++) {
      let value = lanes[lane]!;
      value ^= value >> 47n;
      value ^= read64(secret, secret.length - 64 + 8 * lane);
      lanes[lane] = (value * prime32a) & mask;
    }
  }
  const stripes = Math.floor((length - 1 - block * blocks) / 64);
  for (let stripe = 0; stripe < stripes; stripe++) accumulate(blocks * block + stripe * 64, stripe * 8);
  accumulate(length - 64, secret.length - 64 - 7);
  let sum = (size * prime64a) & mask;
  for (let pair = 0; pair < 4; pair++)
    sum += foldedProduct(
      lanes[2 * pair]! ^ read64(secret, 11 + 16 * pair),
      lanes[2 * pair + 1]! ^ read64(secret, 11 + 16 * pair + 8),
    );
  return avalanche(sum & mask);
}
