class Named {
  toString() {
    console.log("toString");
    return "named";
  }
}
console.log(new Named().toLocaleString());
