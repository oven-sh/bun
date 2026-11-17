// Numbers that loops only reckon with, under handlers: inside the loop, around it, and in an outer loop.
const lines = [];
let rate = JSON.parse("1.5");
function wide(p3, p5, p9) {
  let v0;
  let v2 = 0;
  let s = 0;
  for (let i1 = 0; i1 < 4; i1++) {
    try {
      for (let i2 = 0; i2 < 5; i2++) {
        try {
          if (v2 < v2) throw p3;
          v0 = p3.length + p5.length;
        } catch {
          p9 = 2 < (v0 | 0);
        }
        if (v0 === 1) s++;
      }
    } catch (e) {
      s += 1;
    }
    v2 = v2 + p3;
  }
  return [v2 + v0, s, p9].join();
}
function around(r) {
  let s = 0;
  try {
    for (let i = 0; i < 6; i++) {
      s += (i * r) | 0;
      if (i === 4) throw r;
    }
  } catch (e) {
    s = s + ":" + e + ":" + r * 2;
  }
  return s;
}
function inside(r) {
  let s = 0;
  for (let i = 0; i < 6; i++) {
    try {
      s += (i * r) | 0;
      if (i % 2) throw i;
      s -= r;
    } catch (e) {
      s += r / 2 + e;
    }
  }
  return s;
}
function outer(r) {
  let s = 0;
  for (let j = 0; j < 3; j++) {
    try {
      for (let i = 0; i < 4; i++) s += (i * r) | 0;
      if (j === 1) throw j;
    } catch (e) {
      s = s * 2 + r;
    } finally {
      s += r - j;
    }
  }
  return s;
}
function ofVariable() {
  let s = 0;
  for (let i = 0; i < 5; i++) {
    try {
      s += (i * rate) | 0;
      if (i === 3) throw rate;
    } catch (e) {
      s += e * rate;
    }
  }
  return s;
}
function nested(p, q) {
  let a = 0;
  for (let i = 0; i < 3; i++) {
    try {
      for (let k = 0; k < 3; k++) {
        try {
          a += k * p;
          if (a > q) throw a - p;
        } catch (e) {
          a = (p | 0) < e ? e / p : p;
        }
      }
    } catch (e) {
      a += p;
    }
  }
  return a;
}
function say(name, f) {
  let result;
  try {
    result = String(f());
  } catch (error) {
    result = error.name;
  }
  lines.push(name + " " + result);
}
say("wide text", () => wide("abc", [1], 0));
say("wide number", () => wide(5, [1, 2], 1));
for (let round = 0; round < 2; round++) {
  for (const value of [...JSON.parse("[0, 1, 2, 1.5, -0.5, 2147483648, 1e21]"), -0, NaN, "3", "x", null, undefined, true, [2], {}]) {
    rate = value;
    say("around", () => around(value));
    say("inside", () => inside(value));
    say("outer", () => outer(value));
    say("variable", ofVariable);
    say("nested", () => nested(value, 2));
  }
}
console.log(lines.join("\n"));
