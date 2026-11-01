// JSON.stringify and toISOString write a Date straight from its time value. A date whose toJSON, toISOString, valueOf or prototype a program has changed takes the general path.
// CALLS+ writeComment operationAOTJSONAppendDate
// CALLS+ writeDates operationAOTJSONAppendDate
// CALLS+ isoText operationAOTDateToISOString
interface Comment {
  id: number;
  at: Date;
  edited: Date | null;
  seen?: Date;
  body: string;
}
interface Thread {
  id: number;
  at: Date;
  replies: Thread[];
}
interface Issue {
  id: number;
  title: string;
  created: Date;
  closed: Date | null;
  thread: Thread[];
}

export function writeComment(comment: Comment): string {
  return JSON.stringify(comment);
}
export function writeDates(dates: Date[]): string {
  return JSON.stringify(dates);
}
export function isoText(date: Date): string {
  return date.toISOString();
}

const say = (name: string, run: () => unknown) => {
  let said: string;
  try {
    said = String(run());
  } catch (error) {
    said = "throws " + (error as Error).name;
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
  86_400_000,
  -86_400_001,
  951_782_400_000,
  951_868_799_999,
  951_868_800_000,
  1_709_164_800_000,
  4_107_542_400_000,
  253_402_300_799_999,
  253_402_300_800_000,
  -62_167_219_200_000,
  -62_167_219_200_001,
  -62_198_755_200_000,
  8.64e15,
  -8.64e15,
  8.64e15 + 1,
  NaN,
  Infinity,
  1.5,
  -0,
];
const thread = (id: number, depth: number): Thread => ({
  id,
  at: new Date(1_700_000_000_000 + id * 86_400_123),
  replies: depth ? [thread(id * 2 + 1, depth - 1), thread(id * 2 + 2, depth - 1)] : [],
});
const issue: Issue = { id: 1, title: "an issue", created: new Date(0), closed: null, thread: [thread(1, 4)] };

for (const time of times) {
  say("comment " + time, () => writeComment({ id: 1, at: new Date(time), edited: time > 0 ? new Date(-time) : null, body: "b" }));
  say("text " + time, () => isoText(new Date(time)));
}
say("optional date", () => writeComment({ id: 2, at: new Date(2), edited: null, seen: new Date(3), body: "" }));
say("list", () => writeDates(times.map(time => new Date(time))));
say("empty list", () => writeDates([]));
say("nested", () => JSON.stringify(issue));
say("nested, indented", () => JSON.stringify(issue, null, 2));
say("fresh literal", () => JSON.stringify({ issue, now: new Date(5), list: [new Date(6)], none: null as Date | null }));
say("untyped", () => JSON.stringify(JSON.parse(JSON.stringify(issue), (key, value) => (key === "at" || key === "created" ? new Date(value) : value))));
say("alone", () => JSON.stringify(new Date(1234567890123)));
say("alone, invalid", () => JSON.stringify(new Date(NaN)));
say("next to a 16-bit string", () => JSON.stringify({ text: "中文 😀", at: new Date(5) }));
say("next to a 16-bit string, typed", () => writeComment({ id: 3, at: new Date(5), edited: new Date(6), body: "中文 😀" }));
say("many", () => writeDates(Array.from({ length: 3000 }, (_, index) => new Date(index * 1e9))).length);
say("set later", () => {
  const date = new Date(0);
  date.setUTCFullYear(2030, 1, 28);
  date.setUTCHours(23, 59, 59, 7);
  const first = writeDates([date]) + isoText(date);
  date.setTime(NaN);
  return first + writeDates([date]);
});

const withOwn = (name: string | symbol, value: unknown) => {
  const date = new Date(7);
  Object.defineProperty(date, name, { value, configurable: true, writable: true, enumerable: false });
  return date;
};
const everyWay = (name: string, make: () => Date) => {
  say(name + ", typed field", () => writeComment({ id: 4, at: make(), edited: make(), body: "" }));
  say(name + ", typed list", () => writeDates([make()]));
  say(name + ", untyped", () => JSON.stringify({ at: make() } as unknown));
  say(name + ", text", () => isoText(make()));
};
everyWay("own toJSON", () =>
  withOwn("toJSON", function (this: Date, key: string) {
    return "own " + key + " " + this.getTime();
  }),
);
everyWay("own toJSON that is not callable", () => withOwn("toJSON", 1));
everyWay("own toISOString", () => withOwn("toISOString", () => "own text"));
everyWay("own toISOString that is not callable", () => withOwn("toISOString", 1));
everyWay("own valueOf", () => withOwn("valueOf", () => NaN));
everyWay("own Symbol.toPrimitive", () => withOwn(Symbol.toPrimitive, () => Infinity));
everyWay("another own property", () => withOwn("extra", 1));
everyWay("enumerable own property", () => Object.assign(new Date(8), { extra: 1 }));
everyWay("frozen", () => Object.freeze(new Date(9)));
everyWay("no prototype", () => Object.setPrototypeOf(new Date(10), null));
everyWay("another prototype", () =>
  Object.setPrototypeOf(new Date(11), {
    toJSON() {
      return "from another prototype";
    },
    toISOString() {
      return "text from another prototype";
    },
  }),
);
class PlainSubclass extends Date {}
class WithToJSON extends Date {
  toJSON(): string {
    return "subclass toJSON " + this.getTime();
  }
}
class WithToISOString extends Date {
  toISOString(): string {
    return "subclass toISOString " + this.getTime();
  }
}
everyWay("plain subclass", () => new PlainSubclass(12));
everyWay("subclass with toJSON", () => new WithToJSON(13));
everyWay("subclass with toISOString", () => new WithToISOString(14));

const log: string[] = [];
say(
  "replacer",
  () => JSON.stringify({ at: new Date(15) }, (key, value) => (log.push(key + " " + typeof value), value)) + " " + log.splice(0).join(),
);
say("afterwards", () => JSON.stringify(issue).length + " " + writeDates([new Date(22)]));
(globalThis as any).kept = [writeComment, writeDates, isoText];
