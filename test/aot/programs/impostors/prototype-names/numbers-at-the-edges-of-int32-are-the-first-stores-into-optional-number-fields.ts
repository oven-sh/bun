// Every store the build can see puts a small integer into these optional number fields, so a narrow slot with a few reserved bit patterns looks enough.
// The numbers that arrive at run time, out of a parsed text, are the smallest int32 values, the largest, the ones just outside, fractions, -0, NaN and the infinities. Each must come back exactly.
class Meter {
  declare id: number;
  declare reading?: number;
  declare offset?: number;
  constructor(id: number) {
    this.id = id;
  }
}
interface Sample {
  id: number;
  reading?: number;
}
function readingOf(meter: Meter) {
  return meter.reading;
}
function setReading(meter: Meter, value: number) {
  meter.reading = value;
}
function addOne(meter: Meter) {
  meter.reading! += 1;
  return meter.reading;
}
function setSample(sample: Sample, value: number) {
  sample.reading = value;
  return sample.reading;
}
function text(value: number | undefined) {
  return Object.is(value, -0) ? "-0" : String(value);
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const meter = new Meter(i);
  sum += readingOf(meter) ?? 1;
  setReading(meter, i & 255);
  meter.offset = 3;
  sum += addOne(meter)! + setSample({ id: i }, i & 7)!;
}
console.log("warm", sum);

const parsed: (number | string)[] = JSON.parse(
  '[-2147483648,-2147483647,-2147483646,-2147483645,-2147483644,-2147483643,-2147483642,-2147483649,2147483647,2147483648,2147483646,4294967295,4294967296,-1,0,"-0",0.5,-0.5,1e-320,1e308,9007199254740991,9007199254740993,"NaN","Infinity","-Infinity"]',
);
for (const item of parsed) {
  const value = Number(item);
  const meter = new Meter(1);
  const before = `${text(readingOf(meter))} ${"reading" in meter}`;
  setReading(meter, value);
  const back = readingOf(meter);
  const sample: Sample = { id: 1 };
  const sampled = setSample(sample, value);
  const listing = `${"reading" in meter} [${Object.keys(meter)}] ${JSON.stringify(meter)} ${JSON.stringify(sample)}`;
  const more = addOne(meter);
  setReading(meter, 5);
  const small = readingOf(meter);
  setReading(meter, value);
  console.log(`${item}: ${before} -> ${text(back)} ${Object.is(back, value)} ${Object.is(sampled, value)} ${listing} | +1 ${text(more)} ${Object.is(more, value + 1)} | ${small} ${Object.is(readingOf(meter), value)} [${Object.keys(meter)}]`);
}
const meter = new Meter(2);
meter.offset = Number(parsed[0]);
setReading(meter, Number(parsed[1]));
delete meter.offset;
console.log("one deleted:", text(meter.offset), "offset" in meter, text(readingOf(meter)), Object.keys(meter).join());
meter.offset = Number(parsed[2]);
console.log("stored again:", text(meter.offset), text(readingOf(meter)), Object.keys(meter).join());
