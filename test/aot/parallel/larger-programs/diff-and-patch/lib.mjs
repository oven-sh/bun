// A diff: the shortest edit by lines, words and letters, unified text written and read, patches applied with moved places, three texts merged, trees of values compared
export function edits(a, b, same = (x, y) => x === y) {
  const n = a.length, m = b.length, max = n + m;
  let v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d &&
        v[max + k] < v[max + k + 2]) ? v[max + k + 2] : v[max + k] + 1;
      let y = x - k;
      while (x < n && y < m && same(a[x], b[y])) {
        x++;
        y++;
      }
      v[max + k + 1] = x;
      if (x >= n && y >= m) return back(trace, a, b, max);
    }
  }
  return [];
}
export function back(trace, a, b, max) {
  const out = [];
  let x = a.length, y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d], k = x - y;
    const down = k === -d || (k !== d && v[max + k] < v[max + k + 2]);
    const pk = down ? k + 1 : k - 1;
    const px = v[max + pk + 1], py = px - pk;
    while (x > px && y > py && x > 0 && y > 0) {
      x--;
      y--;
      out.push({ op: " ", a: x, b: y, value: a[x] });
    }
    if (d > 0) {
      if (down) {
        y--;
        out.push({ op: "+", a: x, b: y, value: b[y] });
    } else {
        x--;
        out.push({ op: "-", a: x, b: y, value: a[x] });
      }
    }
  }
  return out.reverse();
}
export class Hunk {
  constructor(from, to) {
    this.from = from;
    this.to = to;
    this.lines = [];
  }
  get before() {
    return this.lines.filter(l => l[0] !== "+").map(l => l.slice(1));
  }
  get after() {
    return this.lines.filter(l => l[0] !== "-").map(l => l.slice(1));
  }
  get header() {
    return `@@ -${this.from + 1},${this.before.length} +${this.to + 1},${this.after.length} @@`;
  }
  reverse() {
    const h = new Hunk(this.to, this.from);
    h.lines = this.lines.map(l => (l[0] === "+" ? "-" : l[0] === "-" ? "+" : " ") + l.slice(1));
    return h;
  }
}
export class Patch {
  constructor(hunks) {
    this.hunks = hunks;
  }
  static between(a, b, context = 2) {
    const all = edits(a, b), hunks = [];
    let hunk = null, quiet = 0;
    all.forEach((e, i) => {
      if (e.op === " ") {
        if (!hunk) return;
        hunk.lines.push(" " + e.value);
        if (++quiet > context * 2) {
          hunk.lines.length -= quiet - context;
          hunk = null;
        }
        return;
      }
      if (!hunk) {
        let k = i;
        while (k > 0 && i - k < context && all[k - 1].op === " ") k--;
        hunk = new Hunk(all[k].a, all[k].b);
        for (; k < i; k++) hunk.lines.push(" " + all[k].value);
        hunks.push(hunk);
      }
      hunk.lines.push(e.op + e.value);
      quiet = 0;
  });
    if (hunk && quiet > context) hunk.lines.length -= quiet - context;
    return new Patch(hunks);
  }
  static parse(text) {
    const hunks = [];
    let hunk = null;
    text.split("\n").forEach((line, i) => {
      const m = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(line);
      if (m) {
        hunk = new Hunk(+m[1] - 1, +m[3] - 1);
        hunk.want = [+m[2], +m[4]];
        hunks.push(hunk);
    } else if (hunk && /^[ +-]/.test(line)) hunk.lines.push(line);
      else if (line !== "") throw new SyntaxError(`line ${i + 1}: ${line}`);
  });
    for (const h of hunks) if (h.before.length !== h.want[0] ||
      h.after.length !== h.want[1]) throw new RangeError("wrong counts in " + h.header);
    return new Patch(hunks);
  }
  toString() {
    return this.hunks.map(h => [h.header, ...h.lines].join("\n")).join("\n");
  }
  reverse() {
    return new Patch(this.hunks.map(h => h.reverse()));
  }
  get size() {
    let add = 0, del = 0;
    for (const h of this.hunks) for (const l of h.lines) if (l[0] === "+") add++;
    else if (l[0] === "-") del++;
    return {
      add, del
  };
  }
  apply(lines, { fuzz = 20 } = {}) {
    const out = lines.slice(), rejected = [], moved = [];
    let shift = 0;
    for (const h of this.hunks) {
      const want = h.before;
      const fits = at => at >= 0 && at + want.length <= out.length && want.every((l,
        i) => out[at + i] === l);
      let at = -1;
      for (let d = 0; d <= fuzz; d++) {
        if (fits(h.from + shift + d)) {
          at = h.from + shift + d;
          break;
        }
        if (d && fits(h.from + shift - d)) {
          at = h.from + shift - d;
          break;
        }
      }
      if (at < 0) {
        rejected.push(h);
        continue;
      }
      if (at !== h.from + shift) moved.push(at - h.from - shift);
      out.splice(at, want.length, ...h.after);
      shift = at - h.from + h.after.length - want.length;
    }
    return {
      lines: out, rejected, moved
  };
  }
}
export function merge(base, left, right, names = ["left", "right"]) {
  const regions = side => {
    const out = [];
    let cur = null;
    for (const e of edits(base, side)) {
      if (e.op === " ") {
        cur = null;
        continue;
      }
      if (!cur) {
        cur = {
          from: e.a, to: e.a, lines: []
      };
        out.push(cur);
      }
      if (e.op === "-") cur.to = e.a + 1;
      else cur.lines.push(e.value);
    }
    return out;
};
  const l = regions(left), r = regions(right), out = [];
  let i = 0, j = 0, at = 0, conflicts = 0;
  while (i < l.length || j < r.length) {
    const a = l[i], b = r[j];
    const start = Math.min(a ? a.from : Infinity, b ? b.from : Infinity);
    while (at < start) out.push(base[at++]);
    let end = start, li = i, rj = j;
    for (let grown = true; grown; ) {
      grown = false;
      while (li < l.length && (l[li].from < end || l[li].from === start)) {
        end = Math.max(end, l[li].to);
        li++;
        grown = true;
    } while (rj < r.length && (r[rj].from < end || r[rj].from === start)) {
        end = Math.max(end, r[rj].to);
        rj++;
        grown = true;
      }
    }
    const side = (list, from, to) => {
      const all = [];
      let p = start;
      for (let k = from; k < to; k++) {
        while (p < list[k].from) all.push(base[p++]);
        all.push(...list[k].lines);
        p = list[k].to;
    } while (p < end) all.push(base[p++]);
      return all;
  };
    const L = side(l, i, li), R = side(r, j, rj);
    if (li === i) out.push(...R);
    else if (rj === j || L.join("\n") === R.join("\n")) out.push(...L);
    else {
      conflicts++;
      out.push("<<<<<<< " + names[0], ...L, "=======", ...R, ">>>>>>> " + names[1]);
    }
    i = li;
    j = rj;
    at = end;
} while (at < base.length) out.push(base[at++]);
  return {
    lines: out, conflicts
};
}
export const words = text => text.match(/\w+|\s+|[^\w\s]/g) ?? [];
export const inline = (a, b, parts = words) => {
  let out = "", open = " ";
  for (const e of edits(parts(a), parts(b))) {
    if (e.op !== open) {
      if (open !== " ") out += open === "+" ? "}" : "]";
      if (e.op !== " ") out += e.op === "+" ? "{" : "[";
      open = e.op;
    }
    out += e.value;
  }
  return open === " " ? out : out + (open === "+" ? "}" : "]");
};
export const kind = v => (v === null ? "null" : Array.isArray(v) ? "array" : v instanceof Date ? "date" : typeof v);
export function* compare(a, b, path = []) {
  const ka = kind(a), kb = kind(b);
  if (ka !== kb) {
    yield {
      op: "replace", path, value: b, old: a
  };
    return;
  }
  switch (ka) {
    case "array": {
      const key = v => (v && typeof v === "object" ? JSON.stringify(v) : v);
      let i = 0;
      for (const e of edits(a, b, (x, y) => key(x) === key(y))) {
        if (e.op === " ") i++;
        else if (e.op === "-") yield {
          op: "remove", path: [...path, i], old: e.value
      };
        else yield {
          op: "add", path: [...path, i++], value: e.value
      };
      }
      return;
    }
    case "object": for (const k of Object.keys(a)) if (!Object.hasOwn(b, k)) yield {
      op: "remove", path: [...path, k], old: a[k]
  };
    else yield* compare(a[k], b[k], [...path, k]);
    for (const k of Object.keys(b)) if (!Object.hasOwn(a, k)) yield {
      op: "add", path: [...path, k], value: b[k]
  };
    return;
    case "date": if (a.getTime() !== b.getTime()) yield {
      op: "replace", path, value: b, old: a
  };
    return;
    default: if (!Object.is(a, b)) yield {
      op: "replace", path, value: b, old: a
  };
  }
}
export function change(value, ops) {
  let root = structuredClone(value);
  for (const { op, path, value: v } of ops) {
    if (!path.length) {
      root = v;
      continue;
    }
    let at = root;
    for (const k of path.slice(0, -1)) {
      at = at[k];
      if (at === undefined) throw new RangeError("no path " + path.join("/"));
    }
    const k = path.at(-1);
    if (Array.isArray(at)) {
      if (op === "add") at.splice(k, 0, v);
      else if (op === "remove") at.splice(k, 1);
      else at[k] = v;
  } else if (op === "remove") delete at[k];
    else at[k] = v;
  }
  return root;
}
