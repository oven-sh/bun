class Loud extends RegExp {
  exec(text) {
    console.log("exec", typeof text, text.length);
    return super.exec(text);
  }
}
console.log("banana".replace(new Loud("a"), "-"));
