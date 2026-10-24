class Wide {
  f0 = 0;
  f1 = 1;
  f2 = 2;
  f3 = 3;
  f4 = 4;
  f5 = 5;
  f6 = 6;
  f7 = 7;
  f8 = 8;
  f9 = 9;
  f10 = 10;
  f11 = 11;
  f12 = 12;
  f13 = 13;
  f14 = 14;
  f15 = 15;
  f16 = 16;
  f17 = 17;
  f18 = 18;
  f19 = 19;
  f20 = 20;
  f21 = 21;
  f22 = 22;
  f23 = 23;
  f24 = 24;
  f25 = 25;
  f26 = 26;
  f27 = 27;
  f28 = 28;
  f29 = 29;
  f30 = 30;
  f31 = 31;
  f32 = 32;
  f33 = 33;
  f34 = 34;
  f35 = 35;
  f36 = 36;
  f37 = 37;
  f38 = 38;
  f39 = 39;
}
class Other {}

const made = [];
const neighbors = [];
for (let i = 0; i < 1000; i++) {
  made.push(Reflect.construct(Wide, [], Other));
  neighbors.push({ a: i, b: "text " + i, c: [i] });
}
let total = 0;
for (const object of made) for (const key of Object.keys(object)) total += object[key];
console.log("keys of the first", Object.keys(made[0]).length);
console.log("the sum of all fields", total);
console.log("the last field of the last object", made[999].f39);
let intact = 0;
for (let i = 0; i < 1000; i++) if (neighbors[i].a === i && neighbors[i].b === "text " + i && neighbors[i].c[0] === i) intact++;
console.log("neighbors that are intact", intact);
