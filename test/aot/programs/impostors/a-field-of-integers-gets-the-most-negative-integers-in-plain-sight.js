function show(value) {
  return Object.is(value, -0) ? "-0" : typeof value + " " + String(value);
}

class Gauge {
  constructor(level) {
    this.level = level | 0;
    this.unit = 1;
  }
}

function OldGauge(level) {
  this.level = level | 0;
  this.unit = 1;
}

function literalGauge(level) {
  return { level: level | 0, unit: 1 };
}

function levelOf(gauge) {
  return gauge.level;
}

function levelOrText(gauge) {
  return gauge.level ?? "nullish";
}

function isUndefined(gauge) {
  return gauge.level === undefined;
}

function isNull(gauge) {
  return gauge.level === null;
}

function plusUnit(gauge) {
  return gauge.level + gauge.unit;
}

function setLevel(gauge, level) {
  gauge.level = level | 0;
}

function setInverted(gauge, level) {
  gauge.level = ~level;
}

function setShifted(gauge, level) {
  gauge.level = level << 1;
}

function report(label, gauge) {
  console.log(
    label + ":",
    show(levelOf(gauge)),
    "|",
    show(levelOrText(gauge)),
    "| undefined",
    isUndefined(gauge),
    "| null",
    isNull(gauge),
    "| plus",
    show(plusUnit(gauge)),
    "| in",
    "level" in gauge,
    "| keys",
    Object.keys(gauge).join(),
    "| json",
    JSON.stringify(gauge),
    "| copy",
    show({ ...gauge }.level),
  );
}

const makers = {
  class: level => new Gauge(level),
  "constructor function": level => new OldGauge(level),
  literal: literalGauge,
};
const levels = [
  0, 5, 2147483647, -2147483641, -2147483642, -2147483643, -2147483644, -2147483645, -2147483646, -2147483647,
  -2147483648,
];

for (const [made, make] of Object.entries(makers)) {
  let warm = 0;
  for (let i = 0; i < 2000; i++) {
    const gauge = make(i);
    setLevel(gauge, i + 1);
    warm += levelOf(gauge) + plusUnit(gauge);
  }
  console.log(made, "2000 honest gauges:", warm);

  for (const level of levels) {
    report(made + " made with " + level, make(level));

    const stored = make(1);
    setLevel(stored, level);
    report(made + " stored " + level, stored);

    const inverted = make(1);
    setInverted(inverted, ~level);
    report(made + " stored ~~" + level, inverted);

    const back = make(level);
    setLevel(back, 3);
    report(made + " made with " + level + " and then stored 3", back);
  }

  const shifted = make(1);
  setShifted(shifted, 1073741825);
  report(made + " stored 1073741825 << 1", shifted);
  setShifted(shifted, -1073741823);
  report(made + " stored -1073741823 << 1", shifted);
}
