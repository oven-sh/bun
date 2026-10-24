// Array.from is written in JavaScript and hidden from stack traces: when JSON.parse, a host function, throws into its frame, its own handler closes the iterator before the caller's catch runs.
const lines: string[] = [];

function texts(name: string, values: string[], closeThrows: boolean): Iterable<string> {
  return {
    [Symbol.iterator](): Iterator<string> {
      let index = 0;
      return {
        next(): IteratorResult<string> {
          lines.push(name + ": next " + index);
          if (index === values.length) return { done: true, value: undefined };
          return { done: false, value: values[index++] };
        },
        return(): IteratorResult<string> {
          lines.push(name + ": return");
          if (closeThrows) throw new RangeError("thrown by return");
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function parseAll(name: string, values: string[], closeThrows = false): void {
  const count = values.length;
  const half = count / 2;
  const label = name.toUpperCase();
  try {
    const parsed = Array.from(texts(name, values, closeThrows), JSON.parse as (text: string) => unknown);
    lines.push(name + ": parsed " + JSON.stringify(parsed));
  } catch (error) {
    lines.push(name + ": caught " + (error as Error).name);
  }
  lines.push(name + ": locals " + count + " " + half + " " + label);
}

parseAll("first text is malformed", ["{", "1"]);
parseAll("second text is malformed", ["1", "{", "2"]);
parseAll("return throws too", ["{"], true);
parseAll("every text is valid", ["1", "[2]", '{"a":3}']);
parseAll("no text", []);

const evaluatedCaller = new Function(
  "iterable",
  "parse",
  "var before = 20 + 1; try { return 'parsed ' + JSON.stringify(Array.from(iterable, parse)); } catch (error) { return 'caught ' + error.name + ' ' + before * 2; }",
) as (iterable: Iterable<string>, parse: (text: string) => unknown) => string;
lines.push("evaluated caller: " + evaluatedCaller(texts("evaluated caller, malformed", ["[", "1"], false), JSON.parse));
lines.push("evaluated caller: " + evaluatedCaller(texts("evaluated caller, valid", ["[1]"], false), JSON.parse));

let closed = 0;
let caught = 0;
let parsedLength = 0;
function repeated(text: string, limit: number): Iterable<string> {
  return {
    [Symbol.iterator](): Iterator<string> {
      let produced = 0;
      return {
        next: (): IteratorResult<string> => (produced++ < limit ? { done: false, value: text } : { done: true, value: undefined }),
        return: (): IteratorResult<string> => {
          closed++;
          return { done: true, value: undefined };
        },
      };
    },
  };
}
for (let round = 0; round < 2000; round++) {
  try {
    parsedLength += Array.from(repeated(round & 1 ? "{" : "7", 3), JSON.parse as (text: string) => unknown).length;
  } catch {
    caught += round;
  }
}
lines.push("2000 rounds: closed " + closed + ", caught " + caught + ", parsed " + parsedLength);

console.log(lines.join("\n"));
export {};
