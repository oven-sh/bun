// Long arrays that hold nothing, or an element here and there, are joined. The text holds a separator between any two places, and making it takes a few times the room of the text:
// a join by which the process grows much further says so. With something of its own for each place a join takes hundreds of megabytes, otherwise a few.
const places = 2 ** 22;
const peak = () => process.resourceUsage().maxRSS * 1024;
const shorten = (text: string) =>
  text.replace(/(,|ab|\u0100)\1+/g, (run, separator) => "<" + run.length / separator.length + ">");

function join(what: string, list: unknown[], separator?: string, inLocale = false) {
  const before = peak();
  let said: string;
  try {
    const text = inLocale ? list.toLocaleString() : separator === undefined ? list.toString() : list.join(separator);
    const grown = peak() - before;
    said = `${text.length} ${text.length < 2 ** 25 ? shorten(text) : ""}`;
    if (grown > 8 * Math.min(text.length, 2 ** 25) + 2 ** 26)
      said += ` and the process grew by ${Math.round(grown / 2 ** 20)} MB`;
  } catch (error) {
    said = (error as Error).name + ": " + (error as Error).message;
  }
  console.log(what + ":", said);
}

function withLength<T>(length: number, list: T[] = []) {
  list.length = length;
  return list;
}

function withElements(length: number, elements: Record<number, unknown>) {
  const list = withLength<unknown>(length);
  for (const [index, element] of Object.entries(elements)) list[Number(index)] = element;
  return list;
}

for (const separator of [",", "", "ab", "\u0100", undefined]) {
  const by = separator === undefined ? "toString" : JSON.stringify(separator);
  join("Array(n) " + by, Array(places), separator);
  join("new Array<number>(n) " + by, new Array<number>(places), separator);
  join("new Array<string>(n) " + by, new Array<string>(places), separator);
  // toString is asked of shorter arrays where the places are not kept side by side.
  const spread = separator === undefined ? 200_000 : places;
  join("length = n " + by, withLength(spread), separator);
  join("an element at the end " + by, withElements(0, { [spread]: "x" }), separator);
  join(
    "elements far apart " + by,
    withElements(spread, { 0: "a", 7: null, 1000: 1.5, 120_000: undefined, 150_000: "b" }),
    separator,
  );
}

join("Array(n) toLocaleString", Array(places), ",", true);
join("length = n toLocaleString", withLength(places), ",", true);
join("elements far apart toLocaleString", withElements(places, { 0: "a", 7: null, 150_000: "b" }), ",", true);
join("the longest array toLocaleString", withLength(2 ** 32 - 1), ",", true);

const fractions: number[] = new Array<number>(1000);
fractions[999] = 0.5;
fractions.length = 999;
join("fractions, the only one cut off", fractions, ",");

join("one place", Array(1), ",");
join("no place", Array(0), ",");
join("two places", Array(2), "ab");

const above = { __proto__: Array.prototype, 2: "above", 200000: "far above" };
join("holes that an object above fills", Object.setPrototypeOf(Array(8), above), ",");
join("holes of a long array that an object above fills", Object.setPrototypeOf(withLength(places), above), ",");

const grows: unknown[] = withLength(places);
grows[1] = {
  toString() {
    grows[300000] = "late";
    return "first";
  },
};
join("an element that stores another behind itself", grows, ",");

const shrinks: unknown[] = withElements(places, { 400000: "gone" });
shrinks[1] = {
  toString() {
    shrinks.length = 10;
    return "first";
  },
};
join("an element that cuts the array", shrinks, ",");

let wide = "w";
for (let i = 0; i < 24; i++) wide += wide;
const reads: number[] = [];
const watched = withLength<unknown>(places);
for (const index of [5, 127, 128, 200]) Object.defineProperty(watched, index, { get: () => void reads.push(index) });
join("a text too long in front of two getters", watched, wide);
console.log("read:", reads.join());

join("as long as a text can be", withLength(2 ** 30), "ab");
join("one separator more", withLength(2 ** 30 + 1), "ab");
join("the longest array", withLength(2 ** 32 - 1), ",");
join("the longest array by nothing", withLength(2 ** 32 - 1), "");
join("the longest array behind one element", withElements(2 ** 32 - 1, { 0: "a" }), "");
