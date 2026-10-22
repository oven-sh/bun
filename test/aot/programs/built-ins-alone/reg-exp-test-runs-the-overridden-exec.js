class Loud extends RegExp {
  exec(text) {
    console.log("exec", typeof text, text.length);
    return super.exec(text);
  }
}
console.log(new Loud("a").test("banana"));
