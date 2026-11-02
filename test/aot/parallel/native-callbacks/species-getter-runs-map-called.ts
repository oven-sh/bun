// map is stored on the parsed value under a name and called as its method.
const log: string[] = [];
class Mine extends Array<number> {
  static get [Symbol.species](): any {
    log.push("getter");
    return Array;
  }
}
const held: any = JSON.parse("{}");
held.list = new Mine();
held.list.walk = held.walk = Array.prototype.map;
log.push(String(held.list.walk((one: number) => one).length));
console.log(log.join("; "));
