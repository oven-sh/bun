class Fixed extends RegExp {
  exec() {
    return { index: 1, 0: "an", length: 1 };
  }
}
console.log("banana".replace(new Fixed("x"), "-"));
