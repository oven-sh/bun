// Flags: --aot-harden=proof-checks
// Both arms of an if name an object anew. The handler of a loop behind them takes the join of the names for the object.
class Gauge {
  constructor() {
    this.level = 0;
  }
}
class Tank {
  gauge;
  constructor(wide = {}) {
    const rim = this.rim;
    this.gauge = new Gauge();
  }
  fill(water, turns) {
    const { gauge } = this;
    if (!water) gauge.spring = water;
    else gauge.spring = new Int16Array(water);
    while (true) {
      try {
        if (gauge.level === 0) {
        }
        if (turns-- < 1) break;
        if (turns === 3) gauge.level = gauge.spring.length;
      } finally {
      }
    }
    this.shown = gauge.note;
    return gauge.level;
  }
}
const usual = { deep: 12 };
class Pond {
  constructor(wide = {}) {
    this.wide = Object.assign({}, usual, wide);
    this.gauge = new Gauge();
  }
  sink(turns) {
    const { gauge, wide } = this;
    const { deep } = wide;
    for (;;) {
      gauge.level = deep;
    }
  }
}
function filled(water, turns, wide = {}) {
  return new Tank(wide).fill(water, turns);
}
function sunk(level, wide = {}) {
  new Pond(wide).sink(level);
}
function work(i) {
  const level = filled(missing + i, i);
  return sunk(level, { rim: "stone" }).length;
}
for (let i = 0; i < 3; i++) {
  try {
    work(i);
  } catch (error) {
    console.log(error.name);
  }
}
for (const [water, turns] of [[0, 2], [5, 6], [null, 3], [2, 4], [null, 5]]) {
  try {
    console.log(filled(water, turns));
  } catch (error) {
    console.log(error.name);
  }
}
