function P(x) { this.x = x; this.y = this.x * 2; this.z = this.x + this.y; }
var o = { m: P, x: 0, y: 0, z: 0 };
for (var i = 0; i < 40; i++) { o.m(i + 0.5); if (o.z !== (i + 0.5) * 3) console.log("wrong", i); var n = new P(i); if (n.z !== i * 3 || Object.keys(n).join() !== "x,y,z") console.log("new", i); }
console.log(o.z, Object.keys(o).join());
