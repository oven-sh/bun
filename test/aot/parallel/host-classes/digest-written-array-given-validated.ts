// `digest(bytes)` and `hash(input, bytes)` write into the array they are given and answer it. An element that was read in front of the call is read again behind it.
// Flags: --aot-validate
function ofAnInstance(): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update("a");
  const bytes = new Uint8Array(64);
  const before = bytes[0];
  const answered = hasher.digest(bytes);
  return [before, bytes[0], bytes[15], answered === bytes].join();
}
function given(hasher: Bun.CryptoHasher, bytes: Uint8Array): string {
  const before = bytes[0] + bytes[15];
  hasher.digest(bytes);
  return [before, bytes[0] + bytes[15]].join();
}
function ofTheClass(): string {
  const bytes = new Uint8Array(64);
  const before = bytes[0];
  const answered = Bun.CryptoHasher.hash("sha1", "a", bytes);
  return [before, bytes[0], answered === bytes].join();
}
function ofAStaticHasher(): string {
  const bytes = new Uint8Array(64);
  const before = bytes[0];
  Bun.SHA256.hash("a", bytes);
  const first = bytes[0];
  const hasher = new Bun.MD5();
  hasher.update("b");
  hasher.digest(bytes);
  return [before, first, bytes[0]].join();
}
function inALoop(): number {
  let sum = 0;
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 500; i++) {
    const hasher = new Bun.CryptoHasher("md5");
    hasher.update(String(i));
    sum = (sum + bytes[0]) | 0;
    hasher.digest(bytes);
    sum = (sum + bytes[0]) | 0;
  }
  return sum;
}
for (let i = 0; i < 3; i++) {
  console.log("of an instance", ofAnInstance());
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update("b" + i);
  console.log("given", given(hasher, new Uint8Array(64)));
  console.log("of the class", ofTheClass());
  console.log("of a static hasher", ofAStaticHasher());
}
console.log("in a loop", inALoop());
