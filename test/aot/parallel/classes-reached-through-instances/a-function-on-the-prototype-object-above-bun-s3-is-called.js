Object.getPrototypeOf(Bun.s3).extra = function () {
  return "mine";
};
console.log(Bun.S3Client.prototype.extra.call(null));
