"use strict";
function f0(a,b,g){var c,d,e,s="",h=a[0],k=a[1],l=a[2],m=a[3];for(c=0;16>c;c++){d=b[c&15];b[c&15]=(g[c&15]+(h|m)+g[c]+(k>>>20^k>>>25^k<<12))&0xffff;d=d+(~k)-0.5;m=(l+d)&0xffff;l=(k+d)^0;k=h;h=(d+g[c]-(h>>22)+(m^m))>>>0;}a[0]=a[0]+h|0;a[1]=a[1]+k|0;a[2]=a[2]+l|0;a[3]=a[3]+m|0;return s+h+','+k+','+l+','+m;}
function f1(a,b,g){var c,d,e,s="",h=a[0],k=a[1],l=a[2];for(c=0;16>c;c++){d=h+(~h)-b[c&7]+b[c&7];d=(d+b[c&7]-(h&l)+(h^l)+(h>>>15^h>>>1^h<<17)+k)|0;b[c&7]=(d+(~l))&0xffff;l=k;k=h;h=(d+g[c]+0x5a827999+(~b[c&7])-b[c+2&7])|0;}a[0]=a[0]+h|0;a[1]=a[1]+k|0;a[2]=a[2]+l|0;return s+h+','+k+','+l;}
function f2(a,b,g){var c,d,e,s="",h=a[0],k=a[1],l=a[2],m=a[3];for(c=0;16>c;c++){d=g[c+5&7]-b[c+8&7];d=d+(b[c&7]>>>16^b[c&7]>>>9^b[c&7]<<16)+(b[c&7]&m)+(k&k);m=(l+d)|0;l=k;k=(h+d)&0xffff;h=(d+(b[c&7]>>>20^b[c&7]<<12))&0xffff;}a[0]=a[0]+h|0;a[1]=a[1]+k|0;a[2]=a[2]+l|0;a[3]=a[3]+m|0;return s+h+','+k+','+l+','+m;}

const ints = k => Array.from({ length: 32 }, (_, i) => Math.imul(i * 7 + k, 0x9e3779b9) | 0);
const uints = k => Array.from({ length: 32 }, (_, i) => Math.imul(i * 5 + k, 0x85ebca6b) >>> 0);
const kinds = {
  ints, uints,
  mixed: k => { const x = ints(k); const y = [1099511627776 - 2147483648].concat(x); y.length = 32; return x.slice(0, 8).concat([1099511627776 - 2147483648]).concat(x.slice(0, 23)); },
  fractions: k => ints(k).map((v, i) => v / 4 + (i & 3)),
  late: k => { const x = uints(k); x[9] = .75; return x; },
  wide: k => ints(k).map((v, i) => i % 5 ? v : v * 2097152),
  wider: k => ints(k).map((v, i) => i % 5 ? v : v * 4194304 * 3),
  edge: k => ints(k).map((v, i) => i % 7 ? v : (i & 1 ? 1 : -1) * 2 ** (47 + i % 8)),
  odd: k => [0, -0, NaN, 1e300, -1e300, Infinity, -Infinity, 2 ** 53, -(2 ** 53), .1].concat(ints(k)).slice(0, 32),
  zeros: k => ints(k).map((v, i) => i % 3 ? v : -0),
  holes: k => { const x = ints(k); delete x[5]; delete x[17]; return x; },
  holesInDoubles: k => { const x = ints(k).map(v => v + .5); delete x[6]; return x; },
  boxed: k => { const x = ints(k); x[3] = "12"; x[4] = undefined; x[7] = null; x[11] = true; return x; },
  short: k => ints(k).slice(0, 12),
  texts: k => ints(k).map((v, i) => i === 10 ? "7" : v),
  objects: k => ints(k).map((v, i) => i === 10 ? { valueOf() { return v; } } : v),
  boxedNumbers: k => { const x = ints(k); x[0] = "q"; x[0] = 5; x[8] = 2.5; return x; },
  boxedWhole: k => { const x = ints(k); x[0] = "q"; x[0] = 5; x[8] = 1099511627776; return x; },
  bytes: k => Uint8Array.from(ints(k)), words: k => Int32Array.from(ints(k)), uwords: k => Uint32Array.from(ints(k)), floats: k => Float64Array.from(ints(k).map(v => v / 2)),
  bigs: k => ints(k).map((v, i) => i === 12 ? 5n : v),
};
let all = 0;
function run(f, n, x, y, z) {
  let r; try { r = f(x, y, z); } catch (e) { r = e.name; }
  const p = String(r) + "|" + Array.from(x, v => typeof v === "object" && v ? "o" : String(v)).slice(0, 5) + "|" + Array.from(y, v => typeof v === "object" && v ? "o" : String(v)).join();
  let h = 0; for (let i = 0; i < p.length; i++) h = Math.imul(h, 31) + p.charCodeAt(i) | 0;
  all = Math.imul(all, 17) + h | 0;
  console.log(n, p.length > 150 ? p.slice(0, 60) + h : p);
}

const fs=[f0,f1,f2];
const order=['mixed', 'bigs', 'texts', 'boxedWhole', 'holesInDoubles', 'uints', 'late', 'holes', 'wide', 'words', 'objects', 'edge', 'short', 'wider', 'ints', 'bytes', 'boxedNumbers', 'odd', 'zeros', 'fractions', 'boxed', 'uwords', 'floats'];

for (let j = 0; j < fs.length; j++) {
  for (const b of order) run(fs[j], j + b, ints(j), kinds[b](j + 1), ints(j + 2));
  for (const g of order) run(fs[j], j + "g" + g, uints(j), kinds.mixed(j + 1), kinds[g](j + 2));
  for (const a of order) run(fs[j], j + "a" + a, kinds[a](j), kinds.ints(j + 1), kinds.uints(j + 2));
  const x = kinds.mixed(j), y = kinds.ints(j); run(fs[j], j + "alias", ints(j), x, x); run(fs[j], j + "alias2", y, y, y); run(fs[j], j + "alias3", y, kinds.mixed(3), y);
}
console.log(all);

