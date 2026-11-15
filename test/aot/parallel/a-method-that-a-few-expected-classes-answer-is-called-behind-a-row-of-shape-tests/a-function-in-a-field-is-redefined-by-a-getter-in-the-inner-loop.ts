// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
interface Tile { side: number; label: (by: number) => string }
class Disc implements Tile {
  side: number;
  label = (by: number): string => this.side + ":" + by;
  constructor(side: number) { this.side = side; }
}
class Plate implements Tile {
  side: number;
  label(by: number): string { return by + "|" + this.side; }
  constructor(side: number) { this.side = side; }
}
const picks: number[] = JSON.parse("[0,1,1,0,1,0]");
const order = JSON.parse('{"name":"strike","key":"label","at":1}');
const doors: Record<string, (one: any, key: string) => void> = {
  strike(one, key) { Object.defineProperty(one, key, { get() { return (by: number) => "got" + by; }, configurable: true }); },
};
function tell(tiles: Tile[], at: number): string {
  let text = "";
  for (const one of tiles) {
    for (let j = 0; j < 4; ++j) {
      text += one.label(j + 1) + ",";
      if (j === at)
        doors[order.name](one, order.key);
    }
  }
  return text;
}
const said: string[] = [];
for (let round = 0; round < 12; ++round) {
  const heard = tell(picks.map((pick: number, index: number) => pick ? new Plate(index + 1) : new Disc(index + 1)), round % 4 === 3 ? order.at : -1);
  if (round % 4 === 3 || round === 0)
    said.push(heard);
}
console.log(said.join(" "));
