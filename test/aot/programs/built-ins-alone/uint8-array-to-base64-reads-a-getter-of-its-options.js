const options = {
  count: 0,
  get alphabet() {
    this.count++;
    console.log("alphabet", this === options);
    return "base64url";
  },
};
console.log(new Uint8Array([255, 254]).toBase64(options));
console.log(options.count);
