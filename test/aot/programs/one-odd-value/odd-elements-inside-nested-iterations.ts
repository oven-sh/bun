// A value that does not fit its type turns up inside an iteration that was opened behind another typed read: in the inner of two loops, in a pattern in the head of a loop, in the second of two loops.
// The loop goes on with the iterator it has, each iterator is closed once and in the order of the language, and the elements behind the odd one are handled as before.
type Item = { n: number; tag: string };
type Box = { label: string; items: Item[] };

const log: string[] = [];

// The text of an error of the language quotes the source.
function describe(error: unknown): string {
  return error instanceof TypeError ? "TypeError" : (error as Error).message;
}

function listed<T>(name: string, values: T[]): Iterable<T> {
  return {
    [Symbol.iterator]() {
      let index = 0;
      return {
        next() {
          log.push(name + ".next");
          return index < values.length ? { done: false, value: values[index++] } : { done: true, value: undefined as any };
        },
        return() {
          log.push(name + ".return");
          return { done: true, value: undefined as any };
        },
      };
    },
  };
}

function sumNested(boxes: Box[]): string {
  let sum = 0;
  let tags = "";
  for (const box of boxes) {
    for (const item of box.items) {
      sum += item.n;
      tags += item.tag;
    }
  }
  return sum + ":" + tags;
}

function sumBehindARead(holder: { scale: number; boxes: Box[] }): string {
  const scale = holder.scale;
  let sum = 0;
  for (const box of holder.boxes) {
    let local = 0;
    for (const item of box.items) local += item.n * scale;
    sum += local;
  }
  return String(sum);
}

function firstLarge(boxes: Box[], limit: number): string {
  for (const box of boxes) {
    for (const item of box.items) {
      if (item.n > limit) return box.label + "/" + item.tag;
    }
  }
  return "none";
}

function untilNegative(boxes: Box[]): string {
  let seen = "";
  outer: for (const box of boxes) {
    for (const item of box.items) {
      if (item.n < 0) break outer;
      if (item.n === 0) break;
      if (item.n === 1) continue outer;
      seen += item.tag;
    }
    seen += "|";
  }
  return seen;
}

function throwsOn(boxes: Box[], bad: string): string {
  let seen = "";
  try {
    for (const box of boxes) {
      for (const item of box.items) {
        if (item.tag === bad) throw new Error("bad " + item.n);
        seen += item.tag;
      }
    }
  } catch (error) {
    return seen + "!" + describe(error);
  }
  return seen;
}

function twoLoops(first: Item[], second: Item[]): string {
  let sum = 0;
  for (const item of first) sum += item.n;
  let tags = "";
  for (const item of second) tags += item.tag + item.n;
  return sum + ":" + tags;
}

function pairs(list: [string, Item][]): string {
  let out = "";
  for (const [key, item] of list) out += key + "=" + item.n + item.tag + ";";
  return out;
}

function entries(map: Map<string, Item>): string {
  let out = "";
  for (const [key, item] of map) out += key.length + item.tag + item.n + ";";
  return out;
}

function patternInLoop(rows: number[][]): string {
  let sum = 0;
  for (const row of rows) {
    const [a, b = 10, ...rest] = row;
    sum += a + b + rest.length;
  }
  return String(sum);
}

function show(name: string, body: () => string) {
  log.length = 0;
  let result: string;
  try {
    result = body();
  } catch (error) {
    result = "threw " + describe(error);
  }
  console.log(name, result, log.join(" "));
}

const item = (n: number, tag: string): Item => ({ n, tag });
const box = (label: string, ...items: Item[]): Box => ({ label, items });
const good = () => [box("a", item(2, "p"), item(3, "q")), box("b", item(4, "r")), box("c", item(5, "s"), item(6, "t"), item(7, "u"))];
const outside = (text: string): any => JSON.parse(text);

for (let round = 0; round < 3; round++) {
  show("good", () => sumNested(good()));

  // An odd element of the inner loop: first, in the middle, last.
  for (const position of [0, 1, 2]) {
    const boxes = good();
    boxes[2].items[position] = outside('{"n":"x","tag":7}');
    show("odd item " + position, () => sumNested(boxes));
    show("odd item " + position + " scaled", () => sumBehindARead({ scale: 2, boxes }));
  }
  for (const odd of ["null", "5", '"text"', "[1,2]", "{}"]) {
    const boxes = good();
    boxes[1].items.push(outside(odd), item(9, "z"));
    show("item " + odd, () => sumNested(boxes));
    show("item " + odd + " large", () => firstLarge(boxes, 8));
    show("item " + odd + " throws", () => throwsOn(boxes, "z"));
  }

  // An odd element of the outer loop, and items that are no array.
  for (const odd of ["null", "5", '{"label":"o"}', '{"label":"o","items":"xy"}', '{"label":"o","items":[{"n":1.5,"tag":"h"}]}', '{"label":"o","items":{}}']) {
    const boxes = good();
    boxes.splice(1, 0, outside(odd));
    show("box " + odd, () => sumNested(boxes));
    show("box " + odd + " scaled", () => sumBehindARead({ scale: 3, boxes }));
  }
  {
    const boxes = good();
    boxes[1].items = new Set([item(1, "x"), item(2, "y")]) as any;
    show("items are a set", () => sumNested(boxes));
    boxes[1].items = listed("inner", [item(1, "x"), outside('{"n":true,"tag":null}'), item(3, "w")]) as any;
    show("items are listed", () => sumNested(boxes));
    show("listed, found", () => firstLarge(boxes, 2));
    show("listed, thrown", () => throwsOn(boxes, "w"));
    show("listed, left", () => untilNegative(boxes));
    show("both listed", () => firstLarge(listed("outer", boxes) as any, 2));
    show("both listed, thrown", () => throwsOn(listed("outer", boxes) as any, "w"));
    show("both listed, to the end", () => sumNested(listed("outer", boxes) as any));
  }
  {
    const boxes = [box("a", item(2, "p"), item(0, "q"), item(3, "r")), box("b", item(1, "s"), item(4, "t")), box("c", item(5, "u"), outside('{"n":"-1","tag":"v"}'), item(-1, "w"), item(6, "x")), box("d", item(7, "y"))];
    show("breaks and continues", () => untilNegative(boxes));
  }
  show("scale is odd", () => sumBehindARead({ scale: outside('"3"'), boxes: good() }));
  show("holder is odd", () => sumBehindARead(outside('{"scale":2,"boxes":[{"label":"j","items":[{"n":4,"tag":"k"}]}]}')));

  // The second of two loops.
  show("second loop", () => twoLoops([item(1, "a")], [item(2, "b"), outside('{"n":{},"tag":[]}'), item(3, "c")]));
  show("first loop", () => twoLoops([item(1, "a"), outside('{"n":"1"}'), item(2, "b")], [item(3, "c")]));
  show("second is listed", () => twoLoops([item(1, "a")], listed("second", [item(2, "b"), outside("{}")]) as any));

  // Patterns.
  show("pairs", () => pairs([["a", item(1, "p")], ["b", item(2, "q")]]));
  show("odd key", () => pairs([["a", item(1, "p")], outside('[5,{"n":2,"tag":"q"}]'), ["c", item(3, "r")]]));
  show("odd value", () => pairs([["a", item(1, "p")], outside('["b",{"n":"2"}]'), ["c", item(3, "r")]]));
  show("short pair", () => pairs([["a", item(1, "p")], outside('["b"]'), ["c", item(3, "r")]]));
  show("pair is text", () => pairs([["a", item(1, "p")], outside('"xy"'), ["c", item(3, "r")]]));
  show("pair is listed", () => pairs([["a", item(1, "p")], listed("pair", ["b", item(2, "q"), "more"]) as any, ["c", item(3, "r")]]));
  show("pair is null", () => pairs([["a", item(1, "p")], outside("null"), ["c", item(3, "r")]]));
  show("pairs are listed", () => pairs(listed("pairs", [["a", item(1, "p")], outside("null")]) as any));
  show("entries", () => entries(new Map([["a", item(1, "p")], ["bb", outside('{"n":null,"tag":2}')], ["ccc", item(3, "r")]])));
  show("odd keys", () => entries(new Map<any, Item>([["a", item(1, "p")], [5, item(2, "q")], ["ccc", item(3, "r")]])));
  show("rows", () => patternInLoop([[1, 2, 3], [4], outside('["5",null,6,7]'), [], [8, undefined as any, 9]]));
  show("row is listed", () => patternInLoop([[1, 2], listed("row", [3]) as any, listed("row", [4, 5, 6, 7]) as any]));
}
