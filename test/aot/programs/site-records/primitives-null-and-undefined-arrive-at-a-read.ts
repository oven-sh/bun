// A read that expects an object gets null, undefined and every kind of primitive value, first of all and between honest objects.
interface Sized {
  length: number;
  description: string;
  size?: number;
}

function attempt(run: () => unknown): string {
  try {
    const value = run();
    return typeof value + " " + String(value);
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

function lengthOf(value: Sized): number {
  return value.length;
}
function descriptionOf(value: Sized): string {
  return value.description;
}
function sizeOf(value: Sized): number | undefined {
  return value.size;
}
function lengthIfAny(value: Sized | null | undefined): number | undefined {
  return value?.length;
}
function look(mark: string, value: unknown): void {
  const sized = value as Sized;
  console.log(mark + ":", attempt(() => lengthOf(sized)), "|", attempt(() => descriptionOf(sized)), "|", attempt(() => sizeOf(sized)), "|", attempt(() => lengthIfAny(sized)));
}

function joined(count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) text = text + "piece " + i + ", ";
  return text;
}

const honest: Sized = { length: 12, description: "honest", size: 3 };

look("null first", null);
look("undefined", undefined);
look("honest", honest);
look("null", null);
look("zero", 0);
look("minus zero", -0);
look("integer", 41);
look("large integer", 2 ** 31);
look("fraction", 1.5);
look("not a number", NaN);
look("infinity", -Infinity);
look("honest", honest);
look("true", true);
look("false", false);
look("empty text", "");
look("text", "text");
look("text in two bytes", "世界");
look("joined text", joined(5));
look("part of a text", joined(9).slice(3, 40));
look("one character", joined(1)[2]);
look("honest", honest);
look("symbol", Symbol("described"));
look("symbol without description", Symbol());
look("registered symbol", Symbol.for("registered"));
look("well-known symbol", Symbol.iterator);
look("small bigint", 10n);
look("negative bigint", -(2n ** 70n));
look("large bigint", 2n ** 200n);
look("honest", honest);
look("undefined at last", undefined);

export {};
