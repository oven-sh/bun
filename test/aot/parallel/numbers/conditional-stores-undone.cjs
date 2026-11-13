// STATISTIC: UndoableStoresMergedAtJoins >= 10
// Loops that store into arrays on some paths and go on. A later check fails in one iteration: what the path has stored is put back.
const show = v => (typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : typeof v === "object" && v ? "{}" : String(v));
const text = list => Array.prototype.map.call(list, show).join(",") + "#" + list.length;
function bounce(x, y, vx, vy, n) {
  for (let i = 0; i < n; i++) {
    x[i] += vx[i] * 0.5;
    y[i] += vy[i] * 0.5;
    if (x[i] < 0 || x[i] > 8) vx[i] = -vx[i];
    if (y[i] < 0 || y[i] > 8) vy[i] = -vy[i];
  }
}
function clamp(x, v, n) {
  for (let i = 0; i < n; i++) {
    x[i] += v[i];
    if (x[i] > 5) x[i] = 5.5;
    if (x[i] < -5) x[i] = -5.5;
    v[i] *= 0.75;
  }
}
function relu(x, y, g, n) {
  for (let i = 0; i < n; i++) {
    if (x[i] > 0) {
      y[i] = x[i];
      g[i] = 1.5;
    } else {
      y[i] = 0.25;
      g[i] = 0.125;
    }
    x[i] = x[i] * 0.5 + g[i];
  }
}
function nested(x, y, g, n) {
  for (let i = 0; i < n; i++) {
    if (x[i] > 0) {
      if (y[i] > 2) y[i] = 2.5;
      else if (y[i] < -2) g[i] = y[i] * 0.5;
      g[i] += 0.5;
    }
    x[i] = x[i] + y[i] * g[i];
  }
}
function integers(p, q, r, n) {
  for (let i = 0; i < n; i++) {
    if (p[i] & 1) q[i] = p[i] + 1;
    else r[i] = p[i] - 1;
    if (q[i] > r[i]) p[i] = q[i] - r[i];
    r[i] = r[i] + p[i] | 0;
  }
}
function skip(x, y, n) {
  for (let i = 0; i < n; i++) {
    if (x[i] > 3) {
      y[i] = 1.5;
      continue;
    }
    if (x[i] < 1) y[i] = x[i] * 2;
    x[i] = y[i] + 0.5;
  }
}
function same(x, y, n) {
  for (let i = 0; i < n; i++) {
    if (y[i] > 2) x[i] = y[i] * 0.5;
    else x[i] = y[i] * 2;
    y[i] = x[i] + y[i];
  }
}
function later(x, v, w, n) {
  for (let i = 0; i < n; i++) {
    if (x[i] > 2) v[i] = -v[i];
    w[i] = w[i] * 0.5 + x[i];
  }
}
function laterOfTwo(x, v, w, n) {
  for (let i = 0; i < n; i++) {
    if (x[i] > 2) v[i] = -v[i];
    else if (x[i] < -2) x[i] = 0.5;
    w[i] = w[i] * 0.5 + x[i];
  }
}
const changes = {
  nothing() {},
  nan(l) {
    l[1][5] = NaN;
  },
  lastNaN(l) {
    for (let i = 0; i < 10; i++) l[l.length - 1][i] = NaN;
  },
  hole(l) {
    delete l[0][6];
  },
  string(l) {
    l[1][4] = "7";
  },
  short(l) {
    l[2 % l.length].length = 5;
  },
  fraction(l) {
    l[0][3] = 0.5;
  },
  large(l) {
    l[0][3] = 2147483647;
  },
  alias(l) {
    l[1] = l[0];
  },
  view(l) {
    l[1] = new Float64Array(l[1]);
  },
  frozen(l) {
    Object.freeze(l[l.length - 1]);
  },
  accessor(l) {
    Object.defineProperty(l[1], 4, { get: () => 5, set: v => log.push(v), configurable: true });
  },
  object(l) {
    l[1][4] = { valueOf: () => (log.push(text(l[0])), 6.5) };
  },
};
const log = [];
const doubles = k => Array.from({ length: 10 }, (_, i) => ((i * 7 + k) % 10) - 4.25 + k * 0.5);
const whole = k => Array.from({ length: 10 }, (_, i) => ((i * 7 + k) % 10) - k);
for (const name of Object.keys(changes)) {
  for (const [work, count, make] of [[bounce, 4, doubles], [clamp, 2, doubles], [relu, 3, doubles], [nested, 3, doubles], [integers, 3, whole], [skip, 2, doubles], [same, 2, doubles], [later, 3, doubles], [laterOfTwo, 3, doubles]]) {
    const lists = [];
    for (let k = 0; k < count; k++) lists.push(make(k));
    changes[name](lists);
    let said = "done";
    try {
      work(...lists, 10);
      work(...lists, 10);
    } catch (e) {
      said = e.constructor.name;
    }
    console.log(name, work.name, said, lists.map(text).join(" "));
  }
}
console.log(log.length, log.slice(0, 6).map(show).join("; "));
