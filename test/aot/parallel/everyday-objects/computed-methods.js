// Methods, accessors and fields with computed names
const prefix = "get";
const names = ["Width", "Height"];
class Box {
  constructor(width, height) {
    this.Width = width;
    this.Height = height;
  }
  [prefix + names[0]]() {
    return this.Width;
  }
  get [names[1].toLowerCase()]() {
    return this.Height * 10;
  }
  static [names.join("")] = names.length;
  ["sum" + names.length] = () => this.Width + this.Height;
}
function read(width, height) {
  const box = new Box(width, height);
  return [box.getWidth(), box.height, Box.WidthHeight, box.sum2(), ...names.map(name => box[name]), box[prefix + "Height"]?.()].map(String).join();
}
console.log(read(1, 2));
console.log(read(30, 40));
console.log(read(0, -1));
