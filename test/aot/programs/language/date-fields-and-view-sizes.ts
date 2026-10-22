// Date getters, setTime and toISOString, and byteLength and byteOffset of typed arrays: the inline fast path, and every receiver and state that must take the slow path.
declare global {
  interface Date {
    getYear(): number;
  }
}
export {};

const lines: string[] = [];

function formatNumber(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function localFieldsOf(date: Date): string {
  return [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getDay(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
    date.getTimezoneOffset(),
    date.getYear(),
  ]
    .map(formatNumber)
    .join(" ");
}

function utcFieldsOf(date: Date): string {
  return [
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCDay(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ]
    .map(formatNumber)
    .join(" ");
}

function fieldsOf(date: Date): string {
  return localFieldsOf(date) + " | " + utcFieldsOf(date) + " | " + formatNumber(date.getTime()) + " " + formatNumber(date.valueOf());
}

function isoOf(date: Date): string {
  try {
    return date.toISOString();
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}

const leapDay = Date.UTC(2024, 1, 29, 23, 59, 59, 999);
const instants: [string, number][] = [
  ["epoch", 0],
  ["one millisecond earlier", -1],
  ["leap day", leapDay],
  ["year -1", Date.parse("-000001-03-04T05:06:07.089Z")],
  ["year 0", Date.parse("0000-01-01T00:00:00.000Z")],
  ["invalid", NaN],
  ["year 9999", Date.parse("9999-12-31T23:59:59.999Z")],
  ["year 10000", Date.parse("+010000-01-01T00:00:00.000Z")],
  ["year 275760", 8.64e15],
  ["year -271821", -8.64e15],
];

for (const [label, time] of instants) {
  const date = new Date(time);
  lines.push(label + ", first read: " + fieldsOf(date));
  lines.push(label + ", second read: " + fieldsOf(date));
  lines.push(label + ", ISO: " + isoOf(date));
}

const reused = new Date(leapDay);
lines.push("before setTime: " + fieldsOf(reused));
for (const [label, time] of instants) {
  const result = reused.setTime(time);
  lines.push(label + ", after setTime: " + formatNumber(result) + " " + fieldsOf(reused) + " " + isoOf(reused));
}
reused.setUTCHours(5);
lines.push("after setUTCHours: " + fieldsOf(reused));

for (const time of [8.64e15, 8.64e15 + 1, -8.64e15, -8.64e15 - 1, -0, 1.9, -1.9, -0.5, NaN, Infinity, -Infinity]) {
  const date = new Date(leapDay);
  const seconds = [date.getUTCSeconds()];
  const result = date.setTime(time);
  seconds.push(date.getUTCSeconds());
  lines.push("setTime(" + formatNumber(time) + "): " + formatNumber(result) + " " + formatNumber(date.getTime()) + " " + seconds.join(" "));
}

const now = Date.now();
lines.push("now: " + (Number.isInteger(now) && now > 1.6e12 && Math.abs(new Date().getTime() - now) < 60_000));

class Stamp extends Date {
  getMinutes(): number {
    return -1;
  }
  getUTCFullYear(): number {
    return super.getUTCFullYear() + 1000;
  }
  toISOString(): string {
    return "stamp " + super.toISOString();
  }
}
const stamp = new Stamp(leapDay);
lines.push("subclass: " + fieldsOf(stamp) + " " + isoOf(stamp));
lines.push("subclass, after setTime: " + formatNumber(stamp.setTime(1.9)) + " " + fieldsOf(stamp) + " " + isoOf(stamp));
lines.push("invalid subclass: " + fieldsOf(new Stamp(NaN)) + " " + isoOf(new Stamp(NaN)));

const patched = new Date(leapDay);
lines.push("before own methods: " + fieldsOf(patched));
patched.getHours = () => 99;
patched.getTime = () => -7;
patched.toISOString = () => "patched";
lines.push("own methods: " + fieldsOf(patched) + " " + isoOf(patched));

function matchesShiftedUTC(date: Date): boolean {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return (
    date.getFullYear() === shifted.getUTCFullYear() &&
    date.getYear() === shifted.getUTCFullYear() - 1900 &&
    date.getMonth() === shifted.getUTCMonth() &&
    date.getDate() === shifted.getUTCDate() &&
    date.getDay() === shifted.getUTCDay() &&
    date.getHours() === shifted.getUTCHours() &&
    date.getMinutes() === shifted.getUTCMinutes() &&
    date.getSeconds() === shifted.getUTCSeconds() &&
    date.getMilliseconds() === shifted.getUTCMilliseconds()
  );
}

const environment = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env;
const longLived = [
  new Date(leapDay),
  new Date(Date.UTC(2021, 5, 15, 12, 30, 45, 678)),
  new Date(Date.UTC(1969, 11, 31, 23, 59, 59, 1)),
];
for (const date of longLived) lines.push("before the zone changes: " + fieldsOf(date));
for (const zone of ["America/Los_Angeles", "Asia/Kolkata", "Australia/Lord_Howe", "Etc/UTC"]) {
  if (environment) environment.TZ = zone;
  for (const date of longLived) {
    lines.push(zone + ": " + (fieldsOf(date) === fieldsOf(new Date(date.getTime()))) + " " + matchesShiftedUTC(date));
  }
}

function checksumOf(date: Date): number {
  return (
    date.getFullYear() +
    date.getYear() * 3 +
    date.getMonth() * 5 +
    date.getDate() * 7 +
    date.getDay() * 11 +
    date.getHours() * 13 +
    date.getMinutes() * 17 +
    date.getSeconds() * 19 +
    date.getMilliseconds() * 23 +
    date.getTimezoneOffset() * 29 +
    date.getUTCFullYear() * 31 +
    date.getUTCMonth() * 37 +
    date.getUTCDate() * 41 +
    date.getUTCDay() * 43 +
    date.getUTCHours() * 47 +
    date.getUTCMinutes() * 53 +
    date.getUTCSeconds() * 59 +
    date.getUTCMilliseconds() * 61
  );
}

let checksum = 0;
let differences = 0;
for (let i = 0; i < 5000; i++) {
  const time = -7e13 + i * 31_556_952_123 + (i % 977);
  const fresh = checksumOf(new Date(time));
  reused.setTime(time);
  if (checksumOf(reused) !== fresh) differences++;
  checksum = (checksum * 31 + fresh + 1_000_000) % 1_000_000_007;
}
lines.push("5000 dates: " + checksum + " " + differences);

const sizesOfInt8 = (view: Int8Array): string => view.byteLength + "@" + view.byteOffset;
const sizesOfUint8 = (view: Uint8Array): string => view.byteLength + "@" + view.byteOffset;
const sizesOfUint8Clamped = (view: Uint8ClampedArray): string => view.byteLength + "@" + view.byteOffset;
const sizesOfInt16 = (view: Int16Array): string => view.byteLength + "@" + view.byteOffset;
const sizesOfUint16 = (view: Uint16Array): string => view.byteLength + "@" + view.byteOffset;
const sizesOfInt32 = (view: Int32Array): string => view.byteLength + "@" + view.byteOffset;
const sizesOfUint32 = (view: Uint32Array): string => view.byteLength + "@" + view.byteOffset;
const sizesOfFloat16 = (view: Float16Array): string => view.byteLength + "@" + view.byteOffset;
const sizesOfFloat32 = (view: Float32Array): string => view.byteLength + "@" + view.byteOffset;
const sizesOfFloat64 = (view: Float64Array): string => view.byteLength + "@" + view.byteOffset;
const sizesOfBigInt64 = (view: BigInt64Array): string => view.byteLength + "@" + view.byteOffset;
const sizesOfBigUint64 = (view: BigUint64Array): string => view.byteLength + "@" + view.byteOffset;
const sizesOfEither = (view: Uint8Array | Float64Array): string => view.byteLength + "@" + view.byteOffset;

const backing = new ArrayBuffer(128);
const int8 = new Int8Array(backing, 8, 3);
const uint8 = new Uint8Array(backing, 9, 5);
const uint8Clamped = new Uint8ClampedArray(backing, 1, 7);
const int16 = new Int16Array(backing, 2, 3);
const uint16 = new Uint16Array(backing, 6);
const int32 = new Int32Array(backing, 4, 5);
const uint32 = new Uint32Array(backing, 12, 1);
const float16 = new Float16Array(backing, 10, 4);
const float32 = new Float32Array(backing, 16, 0);
const float64 = new Float64Array(backing, 24, 2);
const bigInt64 = new BigInt64Array(backing, 32, 3);
const bigUint64 = new BigUint64Array(backing, 40);

function sizesOfOffsetViews(): string {
  return [
    sizesOfInt8(int8),
    sizesOfUint8(uint8),
    sizesOfUint8Clamped(uint8Clamped),
    sizesOfInt16(int16),
    sizesOfUint16(uint16),
    sizesOfInt32(int32),
    sizesOfUint32(uint32),
    sizesOfFloat16(float16),
    sizesOfFloat32(float32),
    sizesOfFloat64(float64),
    sizesOfBigInt64(bigInt64),
    sizesOfBigUint64(bigUint64),
    sizesOfEither(uint8),
    sizesOfEither(float64),
  ].join(" ");
}

lines.push("offset views: " + sizesOfOffsetViews());
let total = 0;
for (let round = 0; round < 1000; round++) {
  total += int16.byteLength + float64.byteLength + bigUint64.byteOffset + round;
}
lines.push("1000 rounds: " + total);
backing.transfer();
lines.push("detached: " + sizesOfOffsetViews());

lines.push(
  "own storage: " +
    [
      sizesOfUint32(new Uint32Array(5)),
      sizesOfFloat64(new Float64Array(3000)),
      sizesOfInt16(new Int16Array(0)),
      sizesOfUint8(new Uint8Array(16).subarray(3, 9)),
    ].join(" "),
);

const resizable = new ArrayBuffer(16, { maxByteLength: 64 });
const tracking = new Uint16Array(resizable, 4);
const bounded = new Uint16Array(resizable, 4, 4);
lines.push("resizable, 16 bytes: " + sizesOfUint16(tracking) + " " + sizesOfUint16(bounded));
for (const size of [40, 8, 2, 64, 12, 11, 5]) {
  resizable.resize(size);
  lines.push("resized to " + size + " bytes: " + sizesOfUint16(tracking) + " " + sizesOfUint16(bounded));
}

const growable = new SharedArrayBuffer(8, { maxByteLength: 32 });
const growing = new Int32Array(growable, 4);
lines.push("growable, 8 bytes: " + sizesOfInt32(growing));
growable.grow(24);
lines.push("grown to 24 bytes: " + sizesOfInt32(growing));

class Odd extends Uint16Array {
  get byteLength(): number {
    return -1;
  }
}
lines.push("subclass: " + sizesOfUint16(new Odd(4)));

const labeled = new Uint16Array(4);
lines.push("before the own property: " + sizesOfUint16(labeled));
Object.defineProperty(labeled, "byteOffset", { value: 77 });
lines.push("own property: " + sizesOfUint16(labeled));

console.log(lines.join("\n"));
