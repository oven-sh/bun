// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
class Disc {
  side;
  label = (by) => this.side + ":" + by;
  constructor(side) { this.side = side; }
}
class Plate {
  side;
  label(by) { return by + "|" + this.side; }
  constructor(side) { this.side = side; }
}
const picks = JSON.parse("[0,1,1,0,1,0]");
const order = JSON.parse('{"name":"strike","key":"label","at":1}');
const doors = {
  strike(one, key) { delete one[key]; Object.getPrototypeOf(one)[key] = (by) => "above" + by; },
};
function tell(tiles, at) {
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
const said = [];
for (let round = 0; round < 12; ++round) {
  const heard = tell(picks.map((pick, index) => pick ? new Plate(index + 1) : new Disc(index + 1)), round % 4 === 3 ? order.at : -1);
  if (round % 4 === 3 || round === 0)
    said.push(heard);
}
console.log(said.join(" "));
