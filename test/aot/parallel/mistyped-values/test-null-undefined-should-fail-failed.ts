// By its declared type only null and undefined can fail each of these tests, and what follows on that side reads or writes a member of the tested value, which throws for those two.
// Values of every other kind arrive: the test tells them apart as it does in plain Bun, and the member is read or written.
const lines: string[] = [];

function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol" || typeof value === "function") return typeof value;
  if (Array.isArray(value)) return "[" + value.map(describe).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

class Point {
  x = 1;
  text = "point";
}

function readsAMember(chunk: string): unknown {
  if (typeof chunk !== "string" && (chunk as any).text) return (chunk as any).text;
  return "nothing";
}

function readsAMemberAndDropsIt(chunk: string): unknown {
  if (typeof chunk !== "string") (chunk as any).text;
  return "done";
}

function writesAMember(chunk: string): unknown {
  if (typeof chunk !== "string") (chunk as any).text = "written";
  return chunk;
}

function readsAnElement(chunk: string): unknown {
  if (typeof chunk !== "string") return (chunk as any)[0];
  return "a string";
}

function writesAnElement(chunk: string): unknown {
  if (typeof chunk !== "string") (chunk as any)[0] = "written";
  return chunk;
}

function aList(list: number[]): unknown {
  if (!Array.isArray(list)) return (list as any).length;
  return "a list";
}

function anInstance(point: Point): unknown {
  if (!(point instanceof Point)) return (point as any).text;
  return "a point";
}

function aNumber(count: number): unknown {
  if (typeof count !== "number") return (count as any).text;
  return "a number";
}

function aResult(text: string): unknown {
  const parsed: string = JSON.parse(text);
  if (typeof parsed !== "string") return (parsed as any).text;
  return "a string";
}

class Holder {
  name: string = "held";
  read(): unknown {
    const name = this.name;
    if (typeof name !== "string") return (name as any).text;
    return "a string";
  }
}

const functions: [string, (value: any) => unknown][] = [
  ["readsAMember", readsAMember],
  ["readsAMemberAndDropsIt", readsAMemberAndDropsIt],
  ["writesAMember", writesAMember],
  ["readsAnElement", readsAnElement],
  ["writesAnElement", writesAnElement],
  ["aList", aList],
  ["anInstance", anInstance],
  ["aNumber", aNumber],
];

function values(): unknown[] {
  const parsed = JSON.parse('[{"text":"one","0":"first","length":7},{"text":""},[5,6],7,true,"text",null]');
  return [
    ...parsed,
    undefined,
    new Point(),
    {
      get text() {
        lines.push("  the getter ran");
        return "got";
      },
      set text(value: string) {
        lines.push("  the setter ran with " + value);
      },
    },
    new Proxy(
      {},
      {
        get(_, key) {
          lines.push("  get " + String(key));
          return "trapped";
        },
        set(_, key, value) {
          lines.push("  set " + String(key) + " " + value);
          return true;
        },
      },
    ),
    Symbol.iterator,
    10n,
    describe,
  ];
}

for (const [name, run] of functions) {
  for (const value of values()) {
    let line: string;
    try {
      line = describe(run(value));
    } catch (error) {
      line = "THREW " + (error as Error).constructor.name;
    }
    lines.push(name + " " + describe(value) + ": " + line);
  }
}
for (const text of ['{"text":"one"}', "[1]", "7", "true", '"text"', "null"]) {
  let line: string;
  try {
    line = describe(aResult(text));
  } catch (error) {
    line = "THREW " + (error as Error).constructor.name;
  }
  lines.push("aResult " + text + ": " + line);
}
for (const value of values()) {
  const holder = new Holder();
  (holder as any).name = value;
  let line: string;
  try {
    line = describe(holder.read());
  } catch (error) {
    line = "THREW " + (error as Error).constructor.name;
  }
  lines.push("a field " + describe(value) + ": " + line);
}
console.log(lines.join("\n"));
