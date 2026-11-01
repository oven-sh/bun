// Alone: the stores of other programs would be seen beside its own
Bun.S3Client.prototype.file.list = [1, 2];
Bun.s3.file.list = { length: 3 };
function read() {
  return Bun.S3Client.prototype.file.list.length;
}
console.log(read());
