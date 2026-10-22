class Counting extends Map {
  count = 0;
  set(key, value) {
    this.count++;
    return super.set(key, value);
  }
}
const map = new Counting();
map.set("a", 1.5);
console.log(map.count, map.get("a") + 1);
