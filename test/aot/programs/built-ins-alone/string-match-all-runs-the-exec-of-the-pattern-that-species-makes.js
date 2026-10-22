class Loud extends RegExp {
  exec(text) {
    console.log("exec", this.lastIndex);
    return super.exec(text);
  }
}
console.log([..."banana".matchAll(new Loud("an", "g"))].length);
