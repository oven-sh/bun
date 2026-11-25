function described(name, size = 1, ...tags) {
  return name + ":" + size + ":" + tags.join("+");
}
const given = ["box", 3, "red", "old"];
console.log(described("bag"), described(...given), described("jar", undefined, "new"));
