// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
// STATISTIC: SpeculatedReceiversDispatchedByShape >= 1
interface Tile {
  side: number;
  label(by: number): string;
}
class Disc implements Tile {
  constructor(public side: number) {}
  label(by: number): string { return this.side + ":" + by; }
}
class Plate implements Tile {
  constructor(public side: number) {}
  label(by: number): string { return by + "|" + typeof this.side; }
}
class Strip implements Tile {
  constructor(public side: number) {}
  label(by: number): string { return String(this.side) + "/" + by; }
}
const picks: number[] = JSON.parse("[0,1,2,1,0,2]");
const order = JSON.parse('{"name":"strike","key":"side","at":1}');
function make(pick: number, index: number): Tile {
  return pick === 0 ? new Disc(index + 1) : pick === 1 ? new Plate(index + 1) : new Strip(index + 1);
}
const doors: Record<string, (one: any, key: string) => void> = {
  strike(one, key) { delete one[key]; },
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
  const heard = tell(picks.map(make), round % 4 === 3 ? order.at : -1);
  if (round % 4 === 3 || round === 0)
    said.push(heard);
}
console.log(said.join(" "));
