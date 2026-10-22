class Loud extends RegExp {
  exec(text) {
    console.log("exec", this.lastIndex);
    return super.exec(text);
  }
}
console.log("a-b".split(new Loud("-")).join());
