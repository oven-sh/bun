// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
class Disc {
  constructor(side) { this.side = side; }
  label(by) { return this.side + ":" + by; }
}
class Plate {
  constructor(side) { this.side = side; }
  label(by) { return by + "|" + typeof this.side; }
}
class Strip {
  constructor(side) { this.side = side; }
  label(by) { return String(this.side) + "/" + by; }
}
const order = JSON.parse('{"name":"strike","key":"side","at":1}');
const doors = {
  strike(one, key) { delete one[key]; },
};
function tell(at) {
  const tiles = [new Disc(1), new Plate(2), new Strip(3), new Plate(4), new Disc(5), new Strip(6)];
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
  const heard = tell(round % 4 === 3 ? order.at : -1);
  if (round % 4 === 3 || round === 0)
    said.push(heard);
}
console.log(said.join(" "));
