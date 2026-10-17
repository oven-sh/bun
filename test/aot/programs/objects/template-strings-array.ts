// The strings array of a tagged template: frozen, with its `raw` property.
declare const console: any;
const t = (s: TemplateStringsArray, ...v: unknown[]): string => JSON.stringify([Array.from(s as readonly unknown[], x => x === undefined ? "UNDEFINED" : x), s.raw, v]);
const v: any = { a: 1 }; const n: number | undefined = 1;
console.log('as', t`A${v as { a: number }}B`, JSON.stringify(String.raw`A${v as { a: number }}B`));
console.log('satisfies', t`A${1 satisfies {}}B`, JSON.stringify(String.raw`A${1 satisfies {}}B`));
console.log('angle', t`A${<{ a: number }>v}B`, JSON.stringify(String.raw`A${<{ a: number }>v}B`));
console.log('bang', t`A${n!}B`, JSON.stringify(String.raw`A${n!}B`));
console.log('as comment', t`A${v as { a: number } /* } */}B`, JSON.stringify(String.raw`A${v as { a: number } /* } */}B`));
console.log('as paren', t`A${(v as { a: number })}B`, JSON.stringify(String.raw`A${(v as { a: number })}B`));
console.log('generic', t`A${((x: { a: number }) => x.a)(v)}B`, JSON.stringify(String.raw`A${((x: { a: number }) => x.a)(v)}B`));
console.log('as const', t`A${{ a: 1 } as const}B`, JSON.stringify(String.raw`A${{ a: 1 } as const}B`));
console.log("typed", t`\xg`);
console.log("typed", t`\u`);
console.log("typed", t`\01`);
console.log("typed", t`\x41`);
function first(s: TemplateStringsArray): unknown { return s[0]; }
try { console.log("typed read", first`\xg` === undefined, first`ok`); } catch (e: any) { console.log("typed read threw", e.constructor.name); }
