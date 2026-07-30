// Temporal differential test case generator.
// Produces self-contained JS expressions that evaluate to a string.
// Each case is a pair: (expr, description).
// Designed to run identically under JSC jsc shell, node --experimental-temporal, and temporal-polyfill.

"use strict";

// Seeded PRNG (xoshiro128**) so runs are reproducible.
function mkrng(seed) {
  let a = seed >>> 0, b = (seed ^ 0x9e3779b9) >>> 0, c = (seed * 2654435761) >>> 0, d = (seed ^ 0xdeadbeef) >>> 0;
  return function rng() {
    const t = (b << 9) >>> 0;
    let r = (a * 5) >>> 0; r = (((r << 7) | (r >>> 25)) * 9) >>> 0;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t;
    d = ((d << 11) | (d >>> 21)) >>> 0;
    return (r >>> 0) / 4294967296;
  };
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function int(rng, lo, hi) { return Math.floor(rng() * (hi - lo + 1)) + lo; }

// Edge-case value pools
const YEARS = [-271821, -271820, -100000, -1, 0, 1, 1582, 1900, 1970, 2000, 2025, 2100, 9999, 100000, 275760];
const MONTHS = [1, 2, 3, 6, 12];
const DAYS = [1, 15, 28, 29, 30, 31];
const HOURS = [0, 1, 12, 23];
const MINS = [0, 30, 59];
const SECS = [0, 30, 59];
const SUBSEC = [0, 1, 500, 999];
const CALENDARS = ["iso8601", "gregory", "japanese", "buddhist", "roc", "hebrew", "islamic-civil", "persian", "chinese", "indian"];
const TIMEZONES = [
  "UTC", "+00:00", "-00:00", "+14:00", "-12:00", "+23:59",
  "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin",
  "Asia/Tokyo", "Australia/Lord_Howe", "Pacific/Chatham", "Pacific/Kiritimati",
  "America/St_Johns", "Asia/Kathmandu", "Africa/Casablanca", "Antarctica/Troll",
];
const ROUNDING = ["ceil", "floor", "expand", "trunc", "halfCeil", "halfFloor", "halfExpand", "halfTrunc", "halfEven"];
const UNITS = ["year", "month", "week", "day", "hour", "minute", "second", "millisecond", "microsecond", "nanosecond"];
const OVERFLOW = ["constrain", "reject"];
const DISAMBIG = ["compatible", "earlier", "later", "reject"];
const OFFSET = ["use", "ignore", "prefer", "reject"];

// Pathological ISO8601 strings (parser stress)
const ISO_STRINGS = [
  '"2025-01-01"', '"2025-01-01T00:00:00"', '"2025-01-01T00:00:00Z"',
  '"2025-01-01T00:00:00+00:00[UTC]"', '"2025-01-01T00:00:00.123456789Z"',
  '"+275760-09-13"', '"-271821-04-20"', '"-000000-01-01"',
  '"2025-02-29"', '"2024-02-29"', '"2025-13-01"', '"2025-00-01"',
  '"2025-01-32"', '"2025-01-00"', '"2025-01-01T24:00:00"',
  '"2025-01-01T23:60:00"', '"2025-01-01T23:59:60"',
  '"2025-01-01[u-ca=hebrew]"', '"2025-01-01[!u-ca=iso8601]"',
  '"2025-01-01T00:00:00+23:59:59.999999999"',
  '"2025-01-01T00:00-00:00[America/New_York]"',
  '"P1Y2M3W4DT5H6M7.123456789S"', '"-P1Y"', '"PT0S"', '"P0D"',
  '"PT" + "9".repeat(20) + "S"', // huge duration
  '"P" + "9".repeat(15) + "D"',
  '"2025-01-01T00:00:00[" + "A".repeat(100) + "]"', // long tz
  '"2025-01-01[u-ca=" + "x".repeat(100) + "]"', // long calendar
  '"\\u0000"', '""', '"2025-01-01\\u0000"',
  '"20250101"', '"20250101T000000Z"',
  '"2025-W01-1"', // week date (not supported by Temporal but parser sees it)
];

// Duration values including overflow-prone
const DUR_FIELDS = () => (rng) => {
  const keys = ["years","months","weeks","days","hours","minutes","seconds","milliseconds","microseconds","nanoseconds"];
  const obj = {};
  const n = int(rng, 1, 4);
  for (let i = 0; i < n; i++) {
    const k = pick(rng, keys);
    obj[k] = pick(rng, [0, 1, -1, 100, -100, 1e6, -1e6, 2**31-1, -(2**31), 2**32, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]);
  }
  return JSON.stringify(obj);
};

// Each generator returns {expr, tags}. expr must evaluate to a value; we wrap in String()/try.
function generators(rng) {
  return [
    // --- Instant ---
    () => ({ expr: `Temporal.Instant.from(${pick(rng, ISO_STRINGS)}).epochNanoseconds`, tags: ["Instant","parse"] }),
    () => ({ expr: `new Temporal.Instant(${pick(rng, ["0n","1n","-1n","86400000000000000000n","-86400000000000000000n","8640000000000000000000n","-8640000000000000000001n"])}).toString()`, tags: ["Instant","ctor"] }),
    () => ({ expr: `Temporal.Instant.fromEpochMilliseconds(${pick(rng,[0,1,-1,8.64e15,-8.64e15,8.64e15+1,Number.MAX_SAFE_INTEGER,NaN,Infinity,-Infinity])}).toString()`, tags:["Instant"] }),
    () => {
      const ns1 = pick(rng, ["0n","1000000000n","-1000000000n","86399999999999999999n"]);
      const ns2 = pick(rng, ["0n","1000000000n","-1000000000n"]);
      const u = pick(rng, UNITS.slice(3));
      return { expr: `new Temporal.Instant(${ns1}).until(new Temporal.Instant(${ns2}), {largestUnit:${JSON.stringify(u)}}).toString()`, tags:["Instant","until"] };
    },
    () => {
      const u = pick(rng, UNITS.slice(4));
      const inc = pick(rng, [1,2,3,5,10,60,1000,86400]);
      const rm = pick(rng, ROUNDING);
      return { expr: `new Temporal.Instant(123456789123456789n).round({smallestUnit:${JSON.stringify(u)}, roundingIncrement:${inc}, roundingMode:${JSON.stringify(rm)}}).epochNanoseconds`, tags:["Instant","round"] };
    },

    // --- PlainDate ---
    () => {
      const y = pick(rng, YEARS), m = pick(rng, MONTHS), d = pick(rng, DAYS), cal = pick(rng, CALENDARS);
      return { expr: `new Temporal.PlainDate(${y},${m},${d},${JSON.stringify(cal)}).toString()`, tags:["PlainDate","ctor","cal"] };
    },
    () => ({ expr: `Temporal.PlainDate.from(${pick(rng, ISO_STRINGS)}).toString()`, tags:["PlainDate","parse"] }),
    () => {
      const y = pick(rng,YEARS), m=pick(rng,MONTHS), d=pick(rng,DAYS);
      const dur = DUR_FIELDS()(rng);
      const ov = pick(rng, OVERFLOW);
      return { expr: `new Temporal.PlainDate(${y},${m},${d}).add(${dur},{overflow:${JSON.stringify(ov)}}).toString()`, tags:["PlainDate","add"] };
    },
    () => {
      const y1=pick(rng,YEARS),y2=pick(rng,YEARS);
      const cal = pick(rng, CALENDARS);
      const lu = pick(rng, UNITS.slice(0,4));
      return { expr: `new Temporal.PlainDate(${y1},1,1,${JSON.stringify(cal)}).until(new Temporal.PlainDate(${y2},1,1,${JSON.stringify(cal)}),{largestUnit:${JSON.stringify(lu)}}).toString()`, tags:["PlainDate","until","cal"] };
    },
    () => {
      const y=pick(rng,YEARS),m=pick(rng,MONTHS),d=pick(rng,DAYS),cal=pick(rng,CALENDARS);
      const fields = pick(rng, ["dayOfYear","dayOfWeek","weekOfYear","daysInMonth","daysInYear","monthsInYear","inLeapYear","year","month","day","monthCode","era","eraYear"]);
      return { expr: `new Temporal.PlainDate(${y},${m},${d},${JSON.stringify(cal)}).${fields}`, tags:["PlainDate","field","cal"] };
    },

    // --- PlainDateTime ---
    () => {
      const y=pick(rng,YEARS),m=pick(rng,MONTHS),d=pick(rng,DAYS),h=pick(rng,HOURS),mi=pick(rng,MINS),s=pick(rng,SECS),ns=pick(rng,SUBSEC);
      return { expr: `new Temporal.PlainDateTime(${y},${m},${d},${h},${mi},${s},${ns},${ns},${ns}).toString()`, tags:["PlainDateTime","ctor"] };
    },
    () => ({ expr: `Temporal.PlainDateTime.from(${pick(rng, ISO_STRINGS)}).toString()`, tags:["PlainDateTime","parse"] }),
    () => {
      const u = pick(rng, UNITS.slice(3));
      const inc = pick(rng, [1,2,5,10,1000,86400]);
      const rm = pick(rng, ROUNDING);
      return { expr: `new Temporal.PlainDateTime(2025,6,15,12,30,45,500,500,500).round({smallestUnit:${JSON.stringify(u)},roundingIncrement:${inc},roundingMode:${JSON.stringify(rm)}}).toString()`, tags:["PlainDateTime","round"] };
    },

    // --- PlainTime ---
    () => {
      const h=pick(rng,HOURS),mi=pick(rng,MINS),s=pick(rng,SECS);
      return { expr: `new Temporal.PlainTime(${h},${mi},${s},${pick(rng,SUBSEC)},${pick(rng,SUBSEC)},${pick(rng,SUBSEC)}).toString()`, tags:["PlainTime"] };
    },
    () => {
      const u = pick(rng, UNITS.slice(4));
      const inc = pick(rng, [1,2,3,4,5,6,10,12,15,20,30,60,100,1000]);
      return { expr: `new Temporal.PlainTime(12,34,56,789,123,456).round({smallestUnit:${JSON.stringify(u)},roundingIncrement:${inc}}).toString()`, tags:["PlainTime","round"] };
    },

    // --- PlainYearMonth ---
    () => {
      const y=pick(rng,YEARS),m=pick(rng,MONTHS),cal=pick(rng,CALENDARS);
      return { expr: `new Temporal.PlainYearMonth(${y},${m},${JSON.stringify(cal)}).toString()`, tags:["PlainYearMonth","cal"] };
    },
    () => {
      const dur = DUR_FIELDS()(rng);
      return { expr: `new Temporal.PlainYearMonth(2025,6).add(${dur}).toString()`, tags:["PlainYearMonth","add"] };
    },

    // --- PlainMonthDay ---
    () => {
      const m=pick(rng,MONTHS),d=pick(rng,DAYS),cal=pick(rng,CALENDARS);
      return { expr: `Temporal.PlainMonthDay.from({monthCode:"M${String(m).padStart(2,"0")}",day:${d},calendar:${JSON.stringify(cal)}}).toString()`, tags:["PlainMonthDay","cal"] };
    },

    // --- Duration ---
    () => ({ expr: `Temporal.Duration.from(${pick(rng, ISO_STRINGS)}).toString()`, tags:["Duration","parse"] }),
    () => {
      const dur = DUR_FIELDS()(rng);
      return { expr: `Temporal.Duration.from(${dur}).toString()`, tags:["Duration","from"] };
    },
    () => {
      const d1 = DUR_FIELDS()(rng), d2 = DUR_FIELDS()(rng);
      const rel = pick(rng, [
        'new Temporal.PlainDate(2025,1,1)',
        'new Temporal.ZonedDateTime(0n,"UTC")',
        'new Temporal.ZonedDateTime(0n,"America/New_York")',
        'undefined',
      ]);
      return { expr: `Temporal.Duration.compare(${d1},${d2},{relativeTo:${rel}})`, tags:["Duration","compare"] };
    },
    () => {
      const dur = DUR_FIELDS()(rng);
      const u = pick(rng, UNITS);
      const rel = pick(rng, ['new Temporal.PlainDate(2025,1,1)', 'new Temporal.ZonedDateTime(0n,"UTC")']);
      return { expr: `Temporal.Duration.from(${dur}).total({unit:${JSON.stringify(u)},relativeTo:${rel}})`, tags:["Duration","total"] };
    },
    () => {
      const dur = DUR_FIELDS()(rng);
      const lu = pick(rng, UNITS), su = pick(rng, UNITS);
      const rel = pick(rng, ['new Temporal.PlainDate(2025,1,1)', 'new Temporal.ZonedDateTime(0n,"America/New_York")', 'undefined']);
      return { expr: `Temporal.Duration.from(${dur}).round({largestUnit:${JSON.stringify(lu)},smallestUnit:${JSON.stringify(su)},relativeTo:${rel}}).toString()`, tags:["Duration","round"] };
    },

    // --- ZonedDateTime (highest complexity) ---
    () => {
      const ns = pick(rng, ["0n","1000000000n","-86400000000000000000n","86399999999999999999n"]);
      const tz = pick(rng, TIMEZONES);
      const cal = pick(rng, CALENDARS);
      return { expr: `new Temporal.ZonedDateTime(${ns},${JSON.stringify(tz)},${JSON.stringify(cal)}).toString()`, tags:["ZonedDateTime","ctor"] };
    },
    () => {
      // DST transition edge: 2025-03-09T02:30 America/New_York doesn't exist
      const dis = pick(rng, DISAMBIG);
      const tz = pick(rng, ["America/New_York","Europe/London","Australia/Lord_Howe","Pacific/Chatham"]);
      return { expr: `Temporal.PlainDateTime.from("2025-03-09T02:30:00").toZonedDateTime(${JSON.stringify(tz)},{disambiguation:${JSON.stringify(dis)}}).toString()`, tags:["ZonedDateTime","DST"] };
    },
    () => {
      const tz = pick(rng, TIMEZONES);
      return { expr: `new Temporal.ZonedDateTime(0n,${JSON.stringify(tz)}).hoursInDay`, tags:["ZonedDateTime","hoursInDay"] };
    },
    () => {
      const tz = pick(rng, TIMEZONES);
      const dur = DUR_FIELDS()(rng);
      return { expr: `new Temporal.ZonedDateTime(0n,${JSON.stringify(tz)}).add(${dur}).toString()`, tags:["ZonedDateTime","add"] };
    },
    () => {
      const tz = pick(rng, TIMEZONES);
      const u = pick(rng, UNITS.slice(3));
      const rm = pick(rng, ROUNDING);
      return { expr: `new Temporal.ZonedDateTime(123456789123456789n,${JSON.stringify(tz)}).round({smallestUnit:${JSON.stringify(u)},roundingMode:${JSON.stringify(rm)}}).toString()`, tags:["ZonedDateTime","round"] };
    },
    () => {
      const tz1 = pick(rng, TIMEZONES), tz2 = pick(rng, TIMEZONES);
      return { expr: `new Temporal.ZonedDateTime(0n,${JSON.stringify(tz1)}).withTimeZone(${JSON.stringify(tz2)}).toString()`, tags:["ZonedDateTime","withTimeZone"] };
    },
    () => {
      const off = pick(rng, OFFSET);
      const dis = pick(rng, DISAMBIG);
      return { expr: `Temporal.ZonedDateTime.from({year:2025,month:3,day:9,hour:2,minute:30,timeZone:"America/New_York",offset:"-05:00"},{offset:${JSON.stringify(off)},disambiguation:${JSON.stringify(dis)}}).toString()`, tags:["ZonedDateTime","from","offset"] };
    },

    // --- with() (field mutation) ---
    () => {
      const cal = pick(rng, CALENDARS);
      const k = pick(rng, ["year","month","day","monthCode"]);
      const v = k === "monthCode" ? '"M05"' : pick(rng, [1,12,28,100,-1,0]);
      return { expr: `new Temporal.PlainDate(2025,6,15,${JSON.stringify(cal)}).with({${k}:${v}}).toString()`, tags:["PlainDate","with","cal"] };
    },

    // --- toLocaleString (ICU) ---
    () => {
      const cal = pick(rng, CALENDARS);
      return { expr: `new Temporal.PlainDate(2025,6,15,${JSON.stringify(cal)}).toLocaleString("en-US")`, tags:["toLocaleString","ICU"] };
    },
  ];
}

function generate(seed, count) {
  const rng = mkrng(seed);
  const gens = generators(rng);
  const cases = [];
  for (let i = 0; i < count; i++) {
    const g = pick(rng, gens);
    const c = g();
    cases.push(c);
  }
  return cases;
}

// Output: one test case per line, as a self-contained expression that prints
// "<idx>|<result-or-THROW:name>"
function emitRunner(cases) {
  let out = 'var results = [];\n';
  for (let i = 0; i < cases.length; i++) {
    out += `try { results.push(${i}+"|"+String((${cases[i].expr}))); } catch(e) { results.push(${i}+"|THROW:"+(e&&e.constructor&&e.constructor.name||"Error")); }\n`;
  }
  out += 'print(results.join("\\n"));\n';
  return out;
}

module.exports = { generate, emitRunner, mkrng, pick, int };

if (require.main === module) {
  const seed = parseInt(process.argv[2] || "1", 10);
  const count = parseInt(process.argv[3] || "100", 10);
  const cases = generate(seed, count);
  const mode = process.argv[4] || "runner";
  if (mode === "runner") process.stdout.write(emitRunner(cases));
  else if (mode === "cases") process.stdout.write(cases.map((c,i)=>i+"\t"+c.tags.join(",")+"\t"+c.expr).join("\n")+"\n");
}
