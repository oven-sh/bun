Object.setPrototypeOf(Object.getPrototypeOf(Bun.s3), { inherited: 5 });
function read() {
  return Bun.S3Client.prototype.inherited;
}
console.log(read());
