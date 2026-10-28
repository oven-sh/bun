// Pairs of loops that run the same function: in the first every optional member of its argument is given, in the second most are left out. ../equivalent-forms.test.ts says which pairs it holds together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

interface Handler {
  id: number;
}
interface Options {
  color?: string;
  background?: string | null;
  bold?: boolean;
  dim?: boolean;
  width?: number;
  height?: number;
  handler?: Handler;
  onChange?: (value: number) => number;
  tags?: string[];
  label: string;
}

const handler: Handler = { id: 7 };
const double = (value: number) => value * 2;
const tags = ["a", "b"];

const given: Options[] = [
  {
    color: "red",
    background: "blue",
    bold: true,
    dim: false,
    width: 3,
    height: 4.5,
    handler,
    onChange: double,
    tags,
    label: "x",
  },
  {
    color: "green",
    background: "gray",
    bold: false,
    dim: true,
    width: 5,
    height: 6.5,
    handler,
    onChange: double,
    tags,
    label: "y",
  },
];
const omitted: Options[] = [
  { color: "red", label: "x" },
  { bold: true, background: null, label: "y" },
];

const empty = Symbol.for("empty");
const newCaches = () => [new Array(12).fill(empty), new Array(12).fill(empty)];

function comparedWithWhatWasKept($: any[], options: Options): number {
  const { color, background, bold, dim, width, height, handler, onChange, tags, label } = options;
  let result: number;
  if (
    $[0] !== color ||
    $[1] !== background ||
    $[2] !== bold ||
    $[3] !== dim ||
    $[4] !== width ||
    $[5] !== height ||
    $[6] !== handler ||
    $[7] !== onChange ||
    $[8] !== tags ||
    $[9] !== label
  ) {
    result = label.length;
    $[0] = color;
    $[1] = background;
    $[2] = bold;
    $[3] = dim;
    $[4] = width;
    $[5] = height;
    $[6] = handler;
    $[7] = onChange;
    $[8] = tags;
    $[9] = label;
    $[10] = result;
  } else result = $[10];
  return result + ($[11] === empty ? 1 : 0);
}

function comparedWithEachOther(a: Options, b: Options): number {
  let same = 0;
  if (a.color === b.color) same++;
  if (a.background === b.background) same++;
  if (a.bold === b.bold) same++;
  if (a.width === b.width) same++;
  if (a.height === b.height) same++;
  if (a.handler === b.handler) same++;
  if (a.onChange === b.onChange) same++;
  if (a.tags === b.tags) same++;
  return same + a.label.length + b.label.length;
}

function comparedLoosely(a: Options, b: Options): number {
  let same = 0;
  if (a.color == b.color) same++;
  if (a.background == b.background) same++;
  if (a.bold == b.bold) same++;
  if (a.width == b.width) same++;
  if (a.handler == b.handler) same++;
  if (a.tags == b.tags) same++;
  return same + a.label.length + b.label.length;
}

function askedWhetherTruthy(options: Options): number {
  let count = 0;
  if (options.color) count++;
  if (options.background) count++;
  if (options.bold) count++;
  if (!options.dim) count++;
  if (options.width) count++;
  if (options.height) count++;
  if (options.handler) count++;
  if (options.onChange) count++;
  if (options.tags) count++;
  return count + options.label.length;
}

function replacedWhereMissing(options: Options): number {
  const color = options.color ?? "black";
  const background = options.background ?? "white";
  const bold = options.bold ?? false;
  const width = options.width ?? 1;
  const height = options.height ?? 1.5;
  const id = options.handler?.id ?? 0;
  const changed = options.onChange?.(width) ?? 0;
  const count = options.tags?.length ?? 0;
  return (
    color.length + background.length + (bold ? 1 : 0) + width + height + id + changed + count + options.label.length
  );
}

function destructuredWithDefaults({ color = "black", bold = false, width = 1, height = 1.5, label }: Options): number {
  return color.length + (bold ? 1 : 0) + width + height + label.length;
}

function calledWithDefaults(
  label: string,
  color: string = "black",
  bold: boolean = false,
  width: number = 1,
  height: number = 1.5,
): number {
  return color.length + (bold ? 1 : 0) + width + height + label.length;
}
const calledThroughAnyValue: any = calledWithDefaults;

function printed(options: Options): number {
  const text = `${options.color}/${options.background}/${options.label}`;
  const joined = options.label + options.color;
  return text.length + joined.length + options.label.length;
}

// What reaches a function through a value of type `any` is what its parameter says only as long as the caller keeps its word.
const alphabet = "abcdefghijklmnopqrstuvwxyz";
const numbers = [1, 2, 3, 4, 5, 6, 7, 8];

function handedOnToBuiltInFunctions(options: Options): number {
  const found = alphabet.indexOf("k", options.width);
  const position = numbers.indexOf(7, options.width);
  const starts = alphabet.startsWith("d", options.width);
  const includes = numbers.includes(8, options.width);
  const text = (255).toString(options.width === undefined ? undefined : 10);
  return found + position + (starts ? 1 : 0) + (includes ? 1 : 0) + text.length + options.label.length;
}

function switchedOn(options: Options): number {
  let sum = 0;
  switch (options.color) {
    case "red":
      sum += 1;
      break;
    case "green":
      sum += 2;
      break;
    default:
      sum += 3;
  }
  switch (options.width) {
    case 3:
      sum += 10;
      break;
    case 5:
      sum += 20;
      break;
    default:
      sum += 30;
  }
  return sum + options.label.length;
}

class Kept {
  color?: string;
  bold?: boolean;
  width?: number;
  handler?: Handler;
  take(options: Options): number | undefined {
    this.color = options.color;
    this.bold = options.bold;
    this.width = options.width;
    this.handler = options.handler;
    return options.width;
  }
}
const kept = new Kept();

function storedAndReturned(options: Options): number {
  return (kept.take(options) === undefined ? 1 : 2) + options.label.length;
}

function over(objects: any[], n: number, run: (object: any, other: any, index: number) => number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += run(objects[i & 1], objects[(i >> 1) & 1], i & 1);
  return sum;
}

const forms: Record<string, (objects: any[], n: number) => number> = {
  "compared with what was kept": (objects, n) => {
    const caches = newCaches();
    return over(objects, n, (object, _, index) => comparedWithWhatWasKept(caches[index], object));
  },
  "compared with each other": (objects, n) => over(objects, n, (object, other) => comparedWithEachOther(object, other)),
  "compared loosely": (objects, n) => over(objects, n, (object, other) => comparedLoosely(object, other)),
  "asked whether truthy": (objects, n) => over(objects, n, object => askedWhetherTruthy(object)),
  "replaced where missing": (objects, n) => over(objects, n, object => replacedWhereMissing(object)),
  "destructured with defaults": (objects, n) => over(objects, n, object => destructuredWithDefaults(object)),
  "arguments with defaults": (objects, n) =>
    over(objects, n, object =>
      calledThroughAnyValue(object.label, object.color, object.bold, object.width, object.height),
    ),
  "handed on to built-in functions": (objects, n) => over(objects, n, object => handedOnToBuiltInFunctions(object)),
  "switched on": (objects, n) => over(objects, n, object => switchedOn(object)),
  "stored and returned": (objects, n) => over(objects, n, object => storedAndReturned(object)),
  printed: (objects, n) => over(objects, n, object => printed(object)),
};

const loops: Record<string, (n: number) => number> = {};
for (const name in forms) {
  loops[`given members ${name}`] = n => forms[name](given, n);
  loops[`omitted members ${name}`] = n => forms[name](omitted, n);
}

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
