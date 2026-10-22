class Special extends RegExp {
  get source() {
    console.log("source");
    return "changed";
  }
}
console.log(new Special("a").toLocaleString());
