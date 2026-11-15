// Results of several shapes are told apart by one test after the other, in loops: read, written, kept and handed on.
const whole = JSON.parse("[" + Array.from({ length: 24 }, (_, k) => (k * 37) % 61).join() + "]");
const mixed = JSON.parse('[1,2,"30",4.5,null,55,[6],7,true,8,9,{"v":10},11,-1,62]');
const kept = [];
let last = null;
let reads = 0;

function sizeOf(v, i) {
  if (v < 10) return { kind: "small", v };
  if (v < 30) return { kind: "middle", v, w: v * 2 };
  if (i & 4) return { kind: "large", v, text: "t" + v };
  return { kind: "none" };
}

function byConditional(vs) {
  let s = 0;
  for (let i = 0; i < vs.length; i++) {
    const r = sizeOf(vs[i], i);
    s = (s + (r.kind === "small" ? r.v : r.kind === "middle" ? r.w : r.kind === "large" ? r.text.length : 1)) | 0;
  }
  return s;
}

function byIf(vs) {
  let s = 0;
  for (let i = 0; i < vs.length; i++) {
    const r = sizeOf(vs[i], i);
    if (r.kind === "small") s += r.v;
    else if (r.kind === "middle") {
      r.w = 7;
      kept.push(r);
      s += r.w;
    } else if (r.kind === "large") s += r.text.length;
    else {
      r.more = i;
      last = r;
      s += r.more;
    }
  }
  return s;
}

function byName(vs) {
  let s = 0;
  for (let i = 0; i < vs.length; i++) {
    const r = sizeOf(vs[i], i);
    if ("w" in r) s += r.w;
    else if ("text" in r) s += r.text.length;
    else if ("v" in r) s += r.v;
    else s--;
  }
  return s;
}

function withGetter(v) {
  if (v & 1) return { kind: 1, get v() { reads++; return v; } };
  if (v & 2) return { kind: 2, v };
  return { v, kind: 3 };
}

function byRepeatedRead(vs) {
  let s = 0;
  for (let i = 0; i < vs.length; i++) {
    const r = withGetter(vs[i]);
    if (r.v > 20) s += r.v;
    else if (r.v > 5) s -= r.v;
    else if (r.kind === 3) s += 100;
    else s += r.kind;
  }
  return s;
}

function attempt(v) {
  try {
    if (v === 37) throw new Error("37");
    if (v === null) return null;
    return v < 30 ? { ok: true, value: v } : { ok: true, value: v, large: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function byAnswer(vs) {
  let s = "";
  for (let i = 0; i < vs.length; i++) {
    const r = attempt(vs[i]);
    if (r === null) s += "-";
    else if (!r.ok) s += "!" + r.error;
    else if (r.large) s += "L" + r.value;
    else s += "." + r.value;
  }
  return s;
}

function assignedTwice(vs) {
  let s = 0;
  for (let i = 0; i < vs.length; i++) {
    let r = sizeOf(vs[i], i);
    if (i === 5) r = { kind: "middle", v: 9, w: 1000 };
    else if (i === 6) r = last ?? r;
    if (r.kind === "small") s += r.v;
    else if (r.kind === "middle") s += r.w;
    else if (r === last) s += 10000;
    else s += r.text === undefined ? 2 : r.text.length;
  }
  return s;
}

for (let turn = 0; turn < 30; turn++) {
  kept.length = 0;
  for (const vs of [whole, mixed]) {
    const results = [byConditional(vs), byIf(vs), byName(vs), byRepeatedRead(vs), byAnswer(vs), assignedTwice(vs)];
    if (turn % 29 === 0) console.log(results.join(" | "), reads, kept.length, JSON.stringify(kept.slice(0, 2)), JSON.stringify(last));
  }
}
