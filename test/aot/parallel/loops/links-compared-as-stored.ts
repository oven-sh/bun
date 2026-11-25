class Wagon {
  load: number;
  ahead: Wagon | null = null;
  behind: Wagon | null = null;
  coupled: Wagon | null = null;
  constructor(load: number) {
    this.load = load;
  }
}
class Train {
  head: Wagon | null = null;
  tail: Wagon | null = null;
  couple(load: number): Wagon {
    const wagon = new Wagon(load);
    let place = this.tail;
    let passed = 0;
    while (place && place.load > load && passed++ < 12) place = place.ahead;
    if (place === this.tail) this.tail = wagon;
    wagon.ahead = place;
    wagon.behind = place ? place.behind : this.head;
    if (wagon.behind) wagon.behind.ahead = wagon;
    if (place) place.behind = wagon;
    else this.head = wagon;
    if (load % 5 === 0) wagon.coupled = place;
    return wagon;
  }
  nearest(load: number): number {
    let steps = 0;
    for (let wagon = this.head; wagon !== null; wagon = steps & 1 ? wagon.behind : wagon.coupled ?? wagon.behind) {
      if (wagon.load === load) return steps;
      if (wagon.ahead == wagon.behind) steps += 100;
      if (wagon.coupled != wagon.ahead) steps++;
      if (++steps > 400) break;
    }
    return -1;
  }
}
function run(k: number): string {
  const train = new Train();
  let sum = 0;
  for (let i = 0; i < 300; i++) train.couple((i * 7919) % 1009);
  for (let i = 0; i < k; i++) sum = (sum + train.nearest(i % 1009)) | 0;
  let walked = 0;
  for (let wagon = train.tail; wagon; wagon = wagon.ahead) walked = (walked * 3 + wagon.load) | 0;
  const ring = new Wagon(1);
  ring.behind = ring;
  let turns = 0;
  for (let at: Wagon | null = ring; at; at = at.behind) {
    if (++turns > 5) at.behind = null;
    if (at === at.behind) sum++;
  }
  return sum + " " + walked + " " + turns;
}
console.log(run(3000), run(17));
