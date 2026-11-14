// A function that hands back a fresh object hands back its fields; its constructor lays them in two orders, by a branch, and the keys of the object that was made of them anew stood in one
class Made {
  constructor(k) {
    if (k & 1) {
      this.a = k;
      this.b = k;
    } else {
      this.b = k;
      this.a = k;
    }
  }
}
class Late {
  constructor(k) {
    k & 1 && (this.a = k);
    this.b = k;
    this.a = k;
  }
}
class Straight {
  constructor(k) {
    this.a = k;
    if (k & 1) this.b = k;
    else this.b = -k;
  }
}
const out = [];
const made = k => new Made(k), late = k => new Late(k), straight = k => new Straight(k);
function run(k) {
  [0, 1, 2, 3].forEach(k => {
    try {
      const o = made(k);
      o.b = o.a;
      const copy = { ...o, z: 1 };
      out.push(Object.keys(copy).join("/"));
    } catch (error) {}
  });
  [0, 1, 2, 3].forEach(k => {
    try {
      const o = late(k);
      o.b = o.a;
      const copy = { ...o, z: 1 };
      out.push(Object.keys(copy).join("/"));
    } catch (error) {}
  });
  [0, 1, 2, 3].forEach(k => {
    try {
      const o = straight(k);
      o.b = o.a;
      const copy = { ...o, z: 1 };
      out.push(Object.keys(copy).join("/"));
    } catch (error) {}
  });
}
for (const k of [0, 3]) {
  try {
    run(k);
  } catch (error) {}
}
console.log(out.join(" "));
