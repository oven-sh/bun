// JSON.stringify writes a Date as Date.prototype.toJSON says: whatever a program has done to the date or to its class is seen.
interface Comment {
  id: number;
  at: Date;
  body: string;
  replies: Comment[];
}
interface Issue {
  id: number;
  title: string;
  created: Date;
  closed: Date | null;
  comments: Comment[];
}
const comment = (id: number, depth: number): Comment => ({
  id,
  at: new Date(1_700_000_000_000 + id * 86_400_123),
  body: "text " + id,
  replies: depth ? [comment(id * 2 + 1, depth - 1), comment(id * 2 + 2, depth - 1)] : [],
});
const issue: Issue = { id: 1, title: "an issue", created: new Date(0), closed: null, comments: [comment(1, 2)] };
const say = (name: string, run: () => unknown) => {
  let said: string;
  try {
    said = String(run());
  } catch (error) {
    said = "throws " + (error as Error).name + ": " + (error as Error).message;
  }
  console.log(name + ": " + said);
};
const times = [
  0,
  1,
  -1,
  999,
  -999,
  1000,
  86_399_999,
  -86_400_001,
  951_782_400_000,
  1_709_164_800_000,
  253_402_300_799_999,
  253_402_300_800_000,
  -62_167_219_200_000,
  -62_167_219_200_001,
  8.64e15,
  -8.64e15,
  8.64e15 + 1,
  NaN,
  Infinity,
  1.5,
  -0,
];
say("typed", () => JSON.stringify(issue));
say("typed, indented", () => JSON.stringify(issue, null, 2));
say("times", () => JSON.stringify(times.map(time => new Date(time))));
say("times in objects", () => JSON.stringify(times.map(time => ({ at: new Date(time), time }))));
say("alone", () => JSON.stringify(new Date(1234567890123)));
say("alone, invalid", () => JSON.stringify(new Date(NaN)));
say("a wide string beside it", () => JSON.stringify({ text: "中文 😀", at: new Date(5) }));
say("set later", () => {
  const date = new Date(0);
  date.setUTCFullYear(2030, 1, 28);
  date.setUTCHours(23, 59, 59, 7);
  const first = JSON.stringify([date]);
  date.setTime(NaN);
  return first + JSON.stringify([date]);
});
say("many", () => JSON.stringify(Array.from({ length: 3000 }, (_, at) => new Date(at * 1e9))).length);

const log: string[] = [];
const own = (name: string | symbol, value: unknown) => {
  const date = new Date(7);
  Object.defineProperty(date, name, { value, configurable: true, writable: true, enumerable: false });
  return date;
};
say("own toJSON", () =>
  JSON.stringify({
    at: own("toJSON", function (this: Date, key: string) {
      return "own " + key + " " + this.getTime();
    }),
  }),
);
say("own toJSON that is no function", () => JSON.stringify({ at: own("toJSON", 1) }));
say("own toISOString", () => JSON.stringify({ at: own("toISOString", () => "own text") }));
say("own toISOString that is no function", () => JSON.stringify({ at: own("toISOString", 1) }));
say("own valueOf", () => JSON.stringify({ at: own("valueOf", () => NaN) }));
say("own Symbol.toPrimitive", () => JSON.stringify({ at: own(Symbol.toPrimitive, () => Infinity) }));
say("another own property", () => JSON.stringify({ at: own("extra", 1) }));
say("an enumerable own property", () => {
  const date = new Date(8) as Date & { extra?: number };
  date.extra = 1;
  return JSON.stringify([date]);
});
say("frozen", () => JSON.stringify([Object.freeze(new Date(9))]));
say("no prototype", () => JSON.stringify([Object.setPrototypeOf(new Date(10), null)]));
say("another prototype", () =>
  JSON.stringify([
    Object.setPrototypeOf(new Date(11), {
      toJSON() {
        return "of another prototype";
      },
    }),
  ]),
);
class Plain extends Date {}
class Speaking extends Date {
  toJSON(): string {
    return "speaking " + this.getTime();
  }
}
class Texted extends Date {
  toISOString(): string {
    return "texted " + this.getTime();
  }
}
say("subclasses", () => JSON.stringify([new Plain(12), new Speaking(13), new Texted(14)]));
say(
  "a replacer sees the text",
  () =>
    JSON.stringify({ at: new Date(15) }, (key, value) => (log.push(key + " " + typeof value), value)) +
    " " +
    log.splice(0).join(),
);

say("at the end", () => JSON.stringify(issue).length + " " + JSON.stringify([new Date(22)]));
