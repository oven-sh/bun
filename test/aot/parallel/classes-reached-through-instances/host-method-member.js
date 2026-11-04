Bun.s3.file.value = "text";
function read() {
  return Bun.S3Client.prototype.file.value;
}
console.log(read());
