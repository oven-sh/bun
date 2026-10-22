try {
  Buffer.alloc(2).readInt32LE(0);
} catch (error) {
  console.log(error instanceof RangeError, error.code);
}
