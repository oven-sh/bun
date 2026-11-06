// C++ leaves open in which order the arguments of a call are evaluated: clang goes from the left on Linux and macOS and from the right on Windows.
// An emitter appends to the B3 procedure as it goes, so `select(lessThan(a, b), add(a, c), a)` would append the comparison first on one host and the
// sum first on the other, and the same program would compile to other code. So at most one argument of a call appends. What comes before it is
//   - a number: `equal(loadCellType(cell), type)`, `m_out.shl(length, 3)`. The operation makes the constant after its first operand is there.
//   - a local:  `Condition isNegative = lessThan(index, 0); select(isNegative, add(index, length), index)`.
// Braces are evaluated from the left on every host, and the body of a lambda runs when it is called.
// Goes by the text of the engine's sources.
import { expect, test } from "bun:test";
import { closingOf, filesOfCompiler, lineOf, sayWhenSkipped, sources } from "./harness/engine-text";

sayWhenSkipped("test/aot/emitters-append-in-the-order-written.test.ts");

type File = { name: string; text: string };

const call = /(m_out\s*\.\s*|[\w>]+::)?\b([A-Za-z_]\w*)\s*(?:<[^()<>;]*(?:<[^()<>;]*>[^()<>;]*)*>)?\s*\(/g;
const keywords = new Set(
  "if for while switch return sizeof alignof decltype static_assert requires noexcept alignas".split(" "),
);
const noType =
  /^(?:static|constexpr|using|friend|return|void|explicit|typedef|enum|struct|class|case|if|else|for|while|new|delete|public|private|protected|inline|operator)\b/;
// A const function of an emitter reaches the procedure through a reference: `in<T>()` converts an operand that is in another representation.
const lowered =
  /^(?:std::optional<)?(?:Condition|Word32|Integer|Number|NumberWithPayload|ImpureNumber|OptionalInteger|OptionalNumber|CellPointer|NarrowReference|Boxed|LiteralStringWord|Pointer|Operand|LValue|TypedPointer|T)\b/;
// These hand on what is there.
const appendNothing =
  "asPointer asWord32 boxCell unboxCell instance at get getInFormOfItsNaN build limit candidateFormsOf".split(" ");
const appendNothingToOutput = new Set(["origin", "address"]);

/** The functions of the emitters that give something back, by name: what their headers declare. */
function functionsThatAppend(files: File[]): Set<string> {
  const names = new Set<string>();
  for (const { name, text } of files) {
    if (!name.endsWith(".h") || !/class \w+ (?:final )?: public \w+Emitter\b|class PrimitiveEmitter\b/.test(text))
      continue;
    for (const found of text.matchAll(
      /(?<=[;{}:>]\s*|\n\s*)([A-Za-z_][\w:]*(?:<[^;(){}]*>)?(?:\s*[*&])?)\s+(\w+)\s*\(/g,
    )) {
      const line = text.slice(text.lastIndexOf("\n", found.index) + 1, found.index);
      if (noType.test(found[1]) || /\b(?:static|constexpr)\b/.test(line)) continue;
      const close = closingOf(text, found.index + found[0].length - 1);
      if (/^\s*const\b/.test(text.slice(close + 1, close + 12)) && !lowered.test(found[1])) continue;
      names.add(found[2]);
    }
  }
  for (const name of appendNothing) names.delete(name);
  return names;
}

function appends(text: string, names: Set<string>): boolean {
  for (const [, qualifier, name] of text.matchAll(call)) {
    if (qualifier ? /^(?:m_out|Output::)/.test(qualifier) && !appendNothingToOutput.has(name) : names.has(name))
      return true;
  }
  return false;
}

/** Where the body of the lambda that begins at `[` lies, between its braces. */
function bodyOfLambda(text: string, afterCaptures: number): [number, number] | undefined {
  const at = text[afterCaptures] === "(" ? closingOf(text, afterCaptures) + 1 : afterCaptures;
  const open = text.indexOf("{", at);
  if (open < 0 || text.slice(at, open).includes(";")) return;
  const close = closingOf(text, open);
  return close < 0 ? undefined : [open + 1, close];
}

function withoutBodiesOfLambdas(text: string): string {
  for (const found of text.matchAll(/(?<=[(,=]\s*|return\s+|^\s*)\[[^\[\]]*\]\s*(?=[({])/g)) {
    const body = bodyOfLambda(text, found.index + found[0].length);
    if (body) text = text.slice(0, body[0]) + text.slice(...body).replace(/[^\n]/g, " ") + text.slice(body[1]);
  }
  return text;
}

/** `auto is = [&](int64_t marker) { return equal(..); };` */
function lambdasThatAppend(text: string, names: Set<string>): string[] {
  return [...text.matchAll(/\bauto\s+(\w+)\s*=\s*\[[^\[\]]*\]\s*(?=[({])/g)].flatMap(found => {
    const body = bodyOfLambda(text, found.index + found[0].length);
    return body && appends(text.slice(...body), names) ? [found[1]] : [];
  });
}

function argumentsOf(text: string, open: number, close: number): string[] {
  const list: string[] = [];
  let [depth, start] = [0, open + 1];
  for (let at = start; at < close; at++) {
    if ("([{".includes(text[at])) depth++;
    else if (")]}".includes(text[at])) depth--;
    else if (text[at] === "," && depth === 0 && !/\w<[\w\s:,*&]*$/.test(text.slice(start, at))) {
      list.push(text.slice(start, at));
      start = at + 1;
    }
  }
  return [...list, text.slice(start, close)];
}

function callsWithTwoArgumentsThatAppend(files: File[]): string[] {
  const declared = functionsThatAppend(files);
  const found: string[] = [];
  for (const { name, text } of files) {
    if (!/\bm_out\b|Emitter/.test(text)) continue;
    const names = new Set(declared);
    // A lambda may call one that is declared after it.
    for (let round = 0; round < 2; round++) for (const lambda of lambdasThatAppend(text, names)) names.add(lambda);
    for (const { index, 0: head, 2: callee } of text.matchAll(call)) {
      const open = index + head.length - 1;
      const close = keywords.has(callee) ? -1 : closingOf(text, open);
      if (close < 0) continue;
      const appending = argumentsOf(text, open, close).filter(
        argument => !/^\s*\[/.test(argument) && appends(withoutBodiesOfLambdas(argument), names),
      );
      if (appending.length > 1)
        found.push(`${name}:${lineOf(text, index)}: ${callee}(${appending.map(it => it.trim()).join(" | ")})`);
    }
  }
  return found;
}

test.skipIf(!sources)("at most one argument of a call appends to the procedure", () => {
  const files = [...filesOfCompiler()];
  expect(functionsThatAppend(files).size).toBeGreaterThan(500);
  expect(callsWithTwoArgumentsThatAppend(files)).toEqual([]);
});

test("the rule finds what it is for", () => {
  const header = {
    name: "codegen/AOTSampleEmitter.h",
    text: `class SampleEmitter final : public OperationEmitter {
    Word32 load(CellPointer);
    Condition equal(Word32, Word32);
    template<typename T> T in(ValueID id) const { return convert(id); }
    const Type& typeOf(ValueID) const;
    static Word32 none();
};`,
  };
  const linesFoundIn = (body: string) =>
    callsWithTwoArgumentsThatAppend([
      header,
      { name: "codegen/AOTSampleEmitter.cpp", text: `// SampleEmitter\n${body}` },
    ]).map(line => Number(line.split(":")[1]) - 1);
  expect(
    linesFoundIn(`equal(load(a), load(b));
equal(load(a), m_out.constInt32(1));
equal(in<Word32>(a), in<Word32>(b));
auto is = [&](int marker) { return equal(bits, marker); };
select(is(1), is(2), c);
define(value, equal(load(a), load(b)));`),
  ).toEqual([1, 2, 3, 5, 6]);
  expect(
    linesFoundIn(`equal(load(a), 1);
equal(loaded, load(b));
define(load(a), typeOf(b), none(), Type::load(c));
either(equal(a, b), [&] { return load(a); }, [&] { return load(b); });
pair({ load(a), load(b) });
m_out.store32(m_out.constInt32(1), m_out.address(heap, base, 8));`),
  ).toEqual([]);
});
