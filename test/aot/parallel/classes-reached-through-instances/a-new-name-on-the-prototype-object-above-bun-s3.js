Object.getPrototypeOf(Bun.s3).extra = 41;
function read() {
  return Bun.S3Client.prototype.extra;
}
console.log(read());
