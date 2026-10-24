// Pairs of loops that check one value: with tests written by hand, and by its type. ../equivalent-forms.test.ts says which pairs it holds together. Only `bun build --compile --aot` builds this file.
import type { Schema } from "bun";
import { validate } from "bun:bundle";

const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

type Line = { sku: string & Schema.MinLength<1>; quantity: number & Schema.Int & Schema.Min<1>; unitCents: number & Schema.Min<0> };

// prettier-ignore
type Wide = { id: number; m00?: number; m01?: number; m02?: number; m03?: number; m04?: number; m05?: number; m06?: number; m07?: number; m08?: number; m09?: number; m10?: number; m11?: number; m12?: number; m13?: number; m14?: number; m15?: number; m16?: number; m17?: number; m18?: number; m19?: number; m20?: number; m21?: number; m22?: number; m23?: number; m24?: number; m25?: number; m26?: number; m27?: number; m28?: number; m29?: number; m30?: number; m31?: number; m32?: number; m33?: number; m34?: number; m35?: number; m36?: number; m37?: number; m38?: number; m39?: number; m40?: number; m41?: number; m42?: number; m43?: number; m44?: number; m45?: number; m46?: number; m47?: number; m48?: number; m49?: number; m50?: number; m51?: number; m52?: number; m53?: number; m54?: number; m55?: number; m56?: number; m57?: number; m58?: number; m59?: number; m60?: number; m61?: number; m62?: number; m63?: number; m64?: number; m65?: number; };

function checkWideByHand(value: unknown): { id: number; m07?: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("expected object");
  const { id, m07 } = value as Record<string, unknown>;
  if (typeof id !== "number" || !Number.isFinite(id)) throw new TypeError("id");
  if (m07 !== undefined && (typeof m07 !== "number" || !Number.isFinite(m07))) throw new TypeError("m07");
  return { id, m07 };
}

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
const narrow: unknown[] = [];
for (let i = 0; i < 8; i++) {
  texts.push(JSON.stringify({ sku: "s" + i, quantity: i + 1, unitCents: 100 * i }));
  refusedTexts.push(JSON.stringify({ sku: "s" + i, quantity: -i, unitCents: 100 * i }));
  parsed.push(JSON.parse(texts[i]));
  refused.push(JSON.parse(refusedTexts[i]));
  narrow.push(JSON.parse(JSON.stringify({ id: i + 1, m07: i })));
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
  "two members checked by hand": n => { let sum = 0; for (let i = 0; i < n; i++) sum += checkWideByHand(narrow[i & 7]).id; return sum; },
  "two members validated by a type of 67": n => { let sum = 0; for (let i = 0; i < n; i++) sum += validate<Wide>(narrow[i & 7]).id; return sum; },
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
