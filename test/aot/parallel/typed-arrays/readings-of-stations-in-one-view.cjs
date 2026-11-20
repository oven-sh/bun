// Twelve stations write their readings into one view, each station's 4096 places behind the one before. The loop over the hours runs once for a group of stations, which nobody can tell:
// not where the view is shorter, loses its memory on the way or is no view at all, and not where what is written reads what a station has written.
// STATISTIC: LoopsDistributed >= 1

function day(sky, warm) {
  for (let hour = 0; hour < 4096; hour++) {
    const air = (hour * 7 + warm) & 127;
    sky[hour] = air;
    sky[hour + 4096] = air + 1;
    sky[hour + 8192] = air - 6;
    sky[hour + 12288] = warm ^ air;
    sky[hour + 16384] = air * 2;
    sky[hour + 20480] = (air & 31) - 7;
    sky[hour + 24576] = 127 - air;
    sky[hour + 28672] = air >> 1;
    sky[hour + 32768] = air | 64;
    sky[hour + 36864] = hour & 63;
    sky[hour + 40960] = hour >> 4;
    sky[hour + 45056] = air ^ 85;
  }
  return sky;
}

// The hours of a station may reach into the places of the next one.
function anyHours(sky, hours, warm) {
  for (let hour = 0; hour < hours; hour++) {
    const air = (hour * 7 + warm) & 127;
    sky[hour] = air;
    sky[hour + 4096] = air + 1;
    sky[hour + 8192] = air - 6;
    sky[hour + 20480] = (air & 31) - 7;
    sky[hour + 28672] = air >> 1;
    sky[hour + 32768] = air | 64;
    sky[hour + 36864] = hour & 63;
    sky[hour + 40960] = hour >> 4;
  }
  return sky;
}

// Each station goes by what another has said.
function echoes(sky) {
  for (let hour = 0; hour < 4096; hour++) {
    const said = sky[hour] + 1;
    sky[hour + 4096] = said;
    sky[hour + 8192] = sky[hour + 4096] + sky[hour + 1];
    sky[hour + 12288] = said * 3;
    sky[hour + 16384] = sky[hour + 12288] - said;
    sky[hour + 20480] = sky[hour + 8192] & 15;
    sky[hour + 24576] = said - sky[hour + 20480];
    sky[hour + 1] = sky[hour + 24576] >> 2;
  }
  return sky;
}

const all = 49152;
function digest(sky, length = sky.length) {
  let sum = 17, none = 0;
  for (let at = 0; at < length; at++) { const value = sky[at]; value === undefined ? none++ : sum = (sum * 31 + Math.round(value * 8)) | 0; }
  return length + ":" + sum + (none ? " without " + none : "");
}
const told = make => { try { return make(); } catch (error) { return error.name; } };

for (const View of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Int32Array, Float32Array, Float64Array]) console.log(View.name, digest(day(new View(all), 3)), digest(day(new View(all), 90.5)), digest(echoes(new View(all).fill(2))));

// Views that end early, that begin late, that lie over one another, that have lost their memory or lose it on the way.
for (const length of [0, 1, 4096, 4097, 20000, all - 1]) console.log("length", length, digest(day(new Int8Array(length), 29)), digest(echoes(new Int8Array(length))));
const memory = new ArrayBuffer(all + 64);
day(new Int8Array(memory, 64), 1); day(new Int8Array(memory, 8, all), 77);
console.log("one memory", digest(new Uint8Array(memory)));
const gone = new Int16Array(all); structuredClone(gone.buffer, { transfer: [gone.buffer] });
console.log("no memory", gone.length, digest(day(gone, 3), 10));
const grows = new Int8Array(new ArrayBuffer(30000, { maxByteLength: all })); day(grows, 8); grows.buffer.resize(all);
console.log("grown", digest(grows), digest(day(grows, 9)));
let asked = 0; const leaves = new Int8Array(all), shrinks = new Int8Array(new ArrayBuffer(all, { maxByteLength: all }));
day(leaves, { valueOf() { if (++asked === 2000) structuredClone(leaves.buffer, { transfer: [leaves.buffer] }); return asked; } });
console.log("left on the way", asked, leaves.length);
day(shrinks, { valueOf() { if (++asked === 9000) shrinks.buffer.resize(9000); return asked; } });
console.log("shrunk on the way", asked, digest(shrinks));

// No views: lists, an object, what a setter hears; values that no such view takes.
console.log("list", digest(day(new Array(all).fill(0), 6)), digest(day([], 6)), digest(echoes(new Array(all).fill(1))));
console.log("object", Object.keys(day({}, 6)).length);
const heard = [];
day(new Proxy({}, { set(target, name, value) { if (heard.length < 30) heard.push(name + "=" + value); return true; } }), 6);
console.log("heard", heard.join(" "));
console.log("others", told(() => day(new BigInt64Array(all), 3)), told(() => day("text", 3)), told(() => day(null, 3)), told(() => day(new Int8Array(all), 4n)), told(() => day(new Int8Array(all), Symbol())));
console.log("odd warmth", digest(day(new Int8Array(all), "9")), digest(day(new Float32Array(all), NaN)), digest(day(new Int8Array(all))));

for (const hours of [0, 1, 4095, 4096, 4097, 5000, 8193, 13000, 12.5, "70", NaN]) console.log("hours", hours, digest(anyHours(new Int8Array(all + 9000), hours, 11)), digest(anyHours(new Float64Array(all), hours, 5)));
