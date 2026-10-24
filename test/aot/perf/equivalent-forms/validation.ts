// Pairs of loops that check one value: with tests written by hand, and by its type. ../equivalent-forms.test.ts says which pairs it holds together. Only `bun build --compile --aot` builds this file.
import type { Schema } from "bun";
import { validate } from "bun:bundle";

const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

type Line = { sku: string & Schema.MinLength<1>; quantity: number & Schema.Int & Schema.Min<1>; unitCents: number & Schema.Min<0> };

function checkByHand(value: unknown): Line {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("expected object");
  const { sku, quantity, unitCents } = value as Record<string, unknown>;
  if (typeof sku !== "string" || sku.length < 1) throw new TypeError("sku");
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) throw new TypeError("quantity");
  if (typeof unitCents !== "number" || !Number.isFinite(unitCents) || unitCents < 0) throw new TypeError("unitCents");
  return { sku, quantity, unitCents };
}

function parseByHand(text: string): Line {
  return checkByHand(JSON.parse(text));
}

const parsed: unknown[] = [];
const refused: unknown[] = [];
const texts: string[] = [];
const refusedTexts: string[] = [];
for (let i = 0; i < 8; i++) {
  texts.push(JSON.stringify({ sku: "s" + i, quantity: i + 1, unitCents: 100 * i }));
  refusedTexts.push(JSON.stringify({ sku: "s" + i, quantity: -i, unitCents: 100 * i }));
  parsed.push(JSON.parse(texts[i]));
  refused.push(JSON.parse(refusedTexts[i]));
}

function createLiteral(i: number): unknown {
  return { sku: "s", quantity: (i & 7) + 1, unitCents: i & 15 };
}

function countRefusals(check: (i: number) => Line, n: number): number {
  let count = 0;
  for (let i = 0; i < n; i++) {
    try {
      count += check(i).quantity;
    } catch {
      count++;
    }
  }
  return count;
}

const loops: Record<string, (n: number) => number> = {
  "a parsed object checked by hand": n => { let sum = 0; for (let i = 0; i < n; i++) sum += checkByHand(parsed[i & 7]).quantity; return sum; },
  "a parsed object validated by its type": n => { let sum = 0; for (let i = 0; i < n; i++) sum += validate<Line>(parsed[i & 7]).quantity; return sum; },
  "a literal of the program checked by hand": n => { let sum = 0; for (let i = 0; i < n; i++) sum += checkByHand(createLiteral(i)).quantity; return sum; },
  "a literal of the program validated by its type": n => { let sum = 0; for (let i = 0; i < n; i++) sum += validate<Line>(createLiteral(i)).quantity; return sum; },
  "a text parsed and checked by hand": n => { let sum = 0; for (let i = 0; i < n; i++) sum += parseByHand(texts[i & 7]).quantity; return sum; },
  "a text parsed by its type": n => { let sum = 0; for (let i = 0; i < n; i++) sum += JSON.parse<Line>(texts[i & 7]).quantity; return sum; },
  "a parsed object refused by hand": n => countRefusals(i => checkByHand(refused[i & 7]), n),
  "a parsed object refused by its type": n => countRefusals(i => validate<Line>(refused[i & 7]), n),
  "a text refused by hand": n => countRefusals(i => parseByHand(refusedTexts[i & 7]), n),
  "a text refused by its type": n => countRefusals(i => JSON.parse<Line>(refusedTexts[i & 7]), n),
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
