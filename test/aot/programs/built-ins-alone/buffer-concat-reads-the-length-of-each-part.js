class Part extends Uint8Array {
  get length() {
    console.log("length");
    return super.length;
  }
}
console.log(Buffer.concat([new Part([104]), new Part([105])]).toString());
