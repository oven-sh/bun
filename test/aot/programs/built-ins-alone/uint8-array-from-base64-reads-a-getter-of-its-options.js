const options = {
  count: 0,
  get alphabet() {
    this.count++;
    console.log("alphabet", this === options);
    return "base64url";
  },
};
console.log(Uint8Array.fromBase64("__4", options).length + 1);
console.log(options.count);
