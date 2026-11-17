const heard: string[] = [];
function drop(target: any, name: string): void {
  delete target[name];
}
function put(target: any, name: string, value: unknown): void {
  target[name] = value;
}
const word: string = JSON.parse('"add"');
function ownWay(this: Set<number>, value: number) {
  heard.push("own" + value);
  return this;
}
class Roll extends Set<number> {}
class Desk {
  roll: Set<number>;
  constructor(roll: Set<number>) {
    this.roll = roll;
  }
}
function enter(desk: Desk, amount: () => number): void {
  desk.roll.add(amount());
}
const sizes: number[] = [];
for (let turn = 0; turn < 40; turn++) {
  put(Roll.prototype, word, ownWay);
  const desk = new Desk(new Roll());
  enter(desk, () => {
    drop(Roll.prototype, word);
    for (let look = 0; look < turn % 10; look++) desk.roll.has(-1);
    return turn;
  });
  sizes.push(desk.roll.size);
}
console.log(heard.length, heard[0], heard[39], sizes.reduce((sum, size) => sum + size, 0));
export {};
