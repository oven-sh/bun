class Loud extends RegExp {
  exec(text) {
    console.log("exec");
    return super.exec(text);
  }
}
console.log("banana".search(new Loud("n")) + 1);
