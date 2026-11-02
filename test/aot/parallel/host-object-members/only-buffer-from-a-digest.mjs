// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const digest = new Bun.CryptoHasher("sha1").update("a").digest();
console.log(
  JSON.stringify(digest).length,
  digest.parent === digest.buffer,
  digest.constructor.isBuffer(digest),
  digest.constructor.from("b").length,
);
