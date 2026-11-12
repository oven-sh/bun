class Box {
  size: number;
  lid: number;
  constructor(size: number) {
    this.size = size;
    this.lid = 1;
  }
}
class Bag {
  weight: number;
  constructor(weight: number) {
    this.weight = weight;
  }
}
class Jar {
  volume: number;
  constructor(volume: number) {
    this.volume = volume;
  }
}
type Item = Box | Bag | Jar | string;
function describe(item: Item): string {
  let text = "" + (item as Box).size;
  if (typeof item !== "string") text += "/" + (item as Box).size;
  return text;
}
const changed = new Box(5);
delete (changed as any).lid;
const items: Item[] = [new Box(1), new Bag(2), new Jar(3), changed, "four"];
for (let index = 0; index < items.length; index++) console.log(describe(items[index]!));
