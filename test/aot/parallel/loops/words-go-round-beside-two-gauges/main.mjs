// STATISTIC: RotatingLoopsUnrolled >= 5
// Four words go round in every turn, and what a gauge showed comes along in two numbers, which are looked at every few turns: kept as they are, scaled, with a count of turns that the caller names, in two halves that look at different turns, in longer rows.
const gauges = new Float64Array(16);
const marks = new BigUint64Array(gauges.buffer);

function kept(north, east, south, west) {
  let before = 0.5;
  let behind = 1.5;
  let first = "none";
  let second = "none";
  for (let turn = 0; turn < 64; turn++) {
    const level = gauges[turn & 7];
    const wind = (north << 11) ^ (north >>> 21) ^ (east | south) ^ west;
    const next = wind ^ Math.imul(turn, 0x13572469) ^ (west << 3) ^ (south >> 3) ^ (east << 11);
    if ((turn & 7) === 0) {
      first = before;
      second = behind;
    }
    before = level;
    behind = level;
    west = south;
    south = east;
    east = north;
    north = next;
  }
  return [first, second, north, east, south, west];
}

function scaled(north, east, south, west) {
  let before = 0.5;
  let behind = 1.5;
  let first = "none";
  let second = "none";
  for (let turn = 0; turn < 64; turn++) {
    const level = gauges[turn & 7];
    const wind = (north << 4) ^ (north >>> 28) ^ (east | south) ^ west;
    const next = wind ^ Math.imul(turn, 0x2468acdf) ^ (west << 9) ^ (south >> 9) ^ (east << 7);
    if ((turn & 7) === 0) {
      first = before * 2;
      second = behind - 1;
    }
    before = level;
    behind = level;
    west = south;
    south = east;
    east = north;
    north = next;
  }
  return [first, second, north, east, south, west];
}

function counted(north, east, south, west, count) {
  const turns = count & 127;
  let before = 0.5;
  let behind = 1.5;
  let first = "none";
  let second = "none";
  for (let turn = 0; turn < turns; turn++) {
    const level = gauges[turn & 7];
    const wind = (north << 6) ^ (north >>> 26) ^ (east | south) ^ west;
    const next = wind ^ Math.imul(turn, 0x0badc1a5) ^ (west << 2) ^ (south >> 6) ^ (east << 10);
    if ((turn & 7) === 0) {
      first = before * 4;
      second = behind + 1;
    }
    before = level;
    behind = level;
    west = south;
    south = east;
    east = north;
    north = next;
  }
  return [first, second, north, east, south, west];
}

function halves(north, east, south, west) {
  let before = 0.5;
  let behind = 1.5;
  let first = "none";
  let second = "none";
  for (let turn = 0; turn < 64; turn++) {
    const level = gauges[turn & 7];
    const wind = turn < 32 ? (east | south) ^ west : east ^ south ^ west;
    const next = wind ^ (north << 11) ^ (north >>> 21) ^ Math.imul(turn, 0x31415927) ^ (west << 3) ^ (south >> 3);
    if ((turn & 7) === 0) {
      first = before - 0.25;
      second = behind * 8;
    }
    before = level;
    behind = level;
    west = south;
    south = east;
    east = north;
    north = next;
  }
  return [first, second, north, east, south, west];
}

function rows(north, east, south, west) {
  let before = 0.5;
  let behind = 1.5;
  let first = "none";
  let second = "none";
  for (let turn = 0; turn < 96; turn++) {
    const level = gauges[turn & 15];
    const wind = (north << 7) ^ (north >>> 25) ^ (east | south) ^ west;
    const next = wind ^ Math.imul(turn, 0x5a17b3c9) ^ (west << 5) ^ (south >> 5) ^ (east << 13);
    if ((turn & 15) === 0) {
      first = before * 0.5;
      second = behind + 3;
    }
    before = level;
    behind = level;
    west = south;
    south = east;
    east = north;
    north = next;
  }
  return [first, second, north, east, south, west];
}

function tell(name, seen) {
  console.log(name, seen.map(each => typeof each + " " + String(each)).join(", "));
}

for (const mark of [0x3ff8000000000000n, 0x7ff8000000000000n, 0xfffc000000000007n]) {
  marks.fill(mark);
  for (const seed of [1, 77, -5]) {
    tell("kept", kept(seed, seed ^ 0x1234567, ~seed, seed << 7));
    tell("scaled", scaled(seed, seed ^ 0x2345671, ~seed, seed << 9));
    for (const count of [7, 16, 100]) tell("counted", counted(seed, seed ^ 0x3456712, ~seed, seed << 3, count));
    tell("halves", halves(seed, seed ^ 0x4567123, ~seed, seed << 5));
    tell("rows", rows(seed, seed ^ 0x5671234, ~seed, seed << 2));
  }
}
