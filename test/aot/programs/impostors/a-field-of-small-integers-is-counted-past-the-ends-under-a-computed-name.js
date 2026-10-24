function show(value) {
  return Object.is(value, -0) ? "-0" : typeof value + " " + String(value);
}

class Gauge {
  constructor(level) {
    this.level = level & 1023;
    this.unit = 1;
  }
}

function levelOf(gauge) {
  return gauge.level;
}

function twiceTheLevel(gauge) {
  return gauge.level + gauge.level;
}

function levelAsInteger(gauge) {
  return gauge.level | 0;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const gauge = new Gauge(i);
  warm += levelOf(gauge) + twiceTheLevel(gauge) + levelAsInteger(gauge);
}
console.log("2000 honest gauges:", warm);

const name = JSON.parse('"level"');

const steps = {
  "++": gauge => gauge[name]++,
  "--": gauge => gauge[name]--,
  "+= 1": gauge => (gauge[name] += 1),
  "-= 1": gauge => (gauge[name] -= 1),
  "*= 2": gauge => (gauge[name] *= 2),
  "*= -1": gauge => (gauge[name] *= -1),
  "/= 2": gauge => (gauge[name] /= 2),
  "%= -1": gauge => (gauge[name] %= -1),
  "**= 2": gauge => (gauge[name] **= 2),
  "<<= 1": gauge => (gauge[name] <<= 1),
  ">>>= 0": gauge => (gauge[name] >>>= 0),
  "|= 0": gauge => (gauge[name] |= 0),
  "&&= 1.5": gauge => (gauge[name] &&= 1.5),
  "||= 'x'": gauge => (gauge[name] ||= "x"),
  "??= 2": gauge => (gauge[name] ??= 2),
  "+= ''": gauge => (gauge[name] += ""),
};

const starts = [
  0, 1, -1, 1023, 2147483646, 2147483647, -2147483642, -2147483643, -2147483644, -2147483645, -2147483646, -2147483647,
  -2147483648,
];

for (const [step, run] of Object.entries(steps)) {
  for (const start of starts) {
    const gauge = new Gauge(0);
    gauge[name] = start;
    const seen = [show(levelOf(gauge))];
    for (let turn = 0; turn < 3; turn++) {
      const answer = run(gauge);
      seen.push(
        show(answer) +
          " -> " +
          show(levelOf(gauge)) +
          " / " +
          show(twiceTheLevel(gauge)) +
          " / " +
          show(levelAsInteger(gauge)),
      );
    }
    console.log(step, "from", start + ":", seen.join(" ; "));
  }
}

const back = new Gauge(7);
console.log("honest again:", show(levelOf(back)), show(twiceTheLevel(back)), show(levelAsInteger(back)));
