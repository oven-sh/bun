function use(b) {
  return Reflect.get(b, "escapeHTML")("<a>");
}
console.log(use(Bun));
