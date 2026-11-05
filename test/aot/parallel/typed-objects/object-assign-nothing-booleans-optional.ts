// Object assign of nothing and booleans onto optional fields.
function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f(), (_, value) => (value === undefined ? "<undefined>" : value)) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ": " + text);
}

type Options = { a: number; text?: string | null; flag?: boolean | null; list?: number[] | null; on?: boolean; name?: string };

function merge(into: Options, from: any): Options {
  return Object.assign(into, from);
}
function show(options: Options) {
  return [Object.keys(options).join(), options.text, options.flag, options.list, options.on, options.name, "flag" in options, "text" in options];
}

const nothings: any[] = [
  { text: undefined, flag: undefined, list: undefined },
  { text: null, flag: null, list: null },
  { flag: true, on: false },
  { flag: false, on: true, text: "t" },
  { on: undefined, name: undefined },
  { list: [1], flag: null, text: undefined },
];
for (const from of nothings) {
  say("onto an object without them " + JSON.stringify(Object.keys(from)), () => show(merge({ a: 1 }, from)));
  say("onto an object that has them", () => show(merge({ a: 1, text: "old", flag: true, list: [9], on: true, name: "n" }, from)));
  say("onto an object that holds nothing in them", () => show(merge({ a: 1, text: null, flag: null, list: undefined, on: undefined, name: undefined }, from)));
}
say("one after another onto one object", () => {
  const made: Options = { a: 1 };
  return nothings.map(from => show(merge(made, from)));
});
say("many, in turn", () => {
  const seen: Record<string, number> = {};
  for (let i = 0; i < 6000; i++) {
    const made = merge(i & 8 ? { a: i, flag: false, text: "x" } : { a: i }, nothings[i % nothings.length]);
    const key = Object.keys(made).join() + "|" + made.flag + "|" + made.text + "|" + made.on;
    seen[key] = (seen[key] ?? 0) + 1;
  }
  return seen;
});
say("deleted, then given nothing", () => {
  const made = merge({ a: 1, flag: true, text: "x" }, {});
  delete made.flag;
  delete made.text;
  return [show(made), show(merge(made, { flag: undefined, text: null }))];
});
say("kept over collections", () => {
  const kept: Options[] = [];
  for (let i = 0; i < 30000; i++) {
    const made = merge({ a: i }, i & 1 ? { text: "s" + i, flag: null } : { text: null, flag: true, list: [i] });
    if (i % 5000 < 2) kept.push(made);
  }
  return kept.map(show);
});
