// Array literals of declared element types that are made for one call, as a type checker makes them: `match([text], none, target)`. Some callees only read them; one captures its parameter in an inner function,
// one keeps it in an object, one returns a part of it. Each callee calls itself, so that it is not taken into its caller. The output is that of plain Bun.
interface Part {
  readonly text: string;
  readonly weight: number;
}
interface Target {
  readonly texts: readonly string[];
  readonly parts: readonly Part[];
}

const none: readonly Part[] = [];
const kept: (readonly string[])[] = [];
const lines: string[] = [];

function joined(texts: readonly string[], parts: readonly Part[], depth: number): string {
  if (depth > 0) return joined(texts, parts, depth - 1);
  let result = "";
  for (let i = 0; i < texts.length; i++) result += texts[i] + (i < parts.length ? parts[i].text + parts[i].weight : "-");
  return result + texts.length + parts.length;
}

function matches(sourceTexts: readonly string[], sourceParts: readonly Part[], target: Target, depth: number): string[] | undefined {
  if (depth > 0) return matches(sourceTexts, sourceParts, target, depth - 1);
  const lastSource = sourceTexts.length - 1;
  const start = sourceTexts[0];
  const end = sourceTexts[lastSource];
  const lastTarget = target.texts.length - 1;
  if ((lastSource === 0 && start.length < target.texts[0].length + target.texts[lastTarget].length) || !start.startsWith(target.texts[0]) || !end.endsWith(target.texts[lastTarget])) return undefined;
  const found: string[] = [];
  let position = target.texts[0].length;
  for (let i = 1; i < lastTarget; i++) {
    const at = start.indexOf(target.texts[i], position);
    if (at < 0) return undefined;
    found.push(start.slice(position, at));
    position = at + target.texts[i].length;
  }
  found.push(start.slice(position, start.length - target.texts[lastTarget].length) + sourceParts.length);
  return found;
}

function matchesThroughInnerFunction(sourceTexts: readonly string[], target: Target, depth: number): string {
  if (depth > 0) return matchesThroughInnerFunction(sourceTexts, target, depth - 1);
  let position = 0;
  let result = "";
  for (const text of target.texts) add(text);
  return result;

  function add(text: string) {
    const at = sourceTexts[0].indexOf(text, position);
    result += at + ":" + sourceTexts.length + ";";
    if (at >= 0) position = at + text.length;
  }
}

function returnsInnerFunction(texts: readonly string[], depth: number): () => string {
  if (depth > 0) return returnsInnerFunction(texts, depth - 1);
  return () => texts.join("+");
}

function keeps(texts: readonly string[], depth: number): number {
  if (depth > 0) return keeps(texts, depth - 1);
  kept.push(texts);
  return texts.length;
}

function wraps(texts: readonly string[], parts: readonly Part[], depth: number): Target {
  if (depth > 0) return wraps(texts, parts, depth - 1);
  return { texts, parts };
}

function firstPart(parts: readonly Part[], depth: number): Part | undefined {
  if (depth > 0) return firstPart(parts, depth - 1);
  Bun.gc(true);
  return parts[0];
}

function sum(numbers: readonly number[], depth: number): number {
  if (depth > 0) return sum(numbers, depth - 1);
  let total = 0;
  for (const n of numbers) total += n;
  return total + numbers.length;
}

function pair(values: readonly [string, number], depth: number): string {
  if (depth > 0) return pair(values, depth - 1);
  const [name, count] = values;
  return name.repeat(count);
}

for (let round = 0; round < 3; round++) {
  const text = "pre" + round + "-mid-" + round + "post";
  const target: Target = { texts: ["pre", "-mid-", "post"], parts: none };
  lines.push(joined([text], none, 2), joined([text, "second" + round], [{ text: "p", weight: round }], 2), joined([], none, 1));
  lines.push(String(matches([text], none, target, 2)), String(matches(["other" + round], none, target, 2)), String(matches([text], [{ text, weight: 1 }], target, 0)));
  lines.push(matchesThroughInnerFunction([text], target, 2), returnsInnerFunction([text, "closed"], 2)(), String(keeps([text, "kept"], 2)));
  const wrapped = wraps([text], [{ text: "w" + round, weight: round }], 2);
  Bun.gc(true);
  lines.push(joined(wrapped.texts, wrapped.parts, 1), JSON.stringify(firstPart([{ text: "first" + round, weight: round }, { text: "second", weight: 0 }], 2)), String(firstPart([], 1)));
  lines.push(String(sum([round, 2, 3], 2)), String(sum([round + 0.5, 1.25], 2)), String(sum([], 1)), pair(["ab" + round, 2], 2));
}
Bun.gc(true);
lines.push(kept.map(texts => texts.join("/")).join("|"), String(new Set(kept).size));
console.log(lines.join("\n"));
