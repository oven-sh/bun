const cases = [
  // attempt succeeds: body parsed twice, the first time erased by restore_parser_snapshot
  `declare const dec: any; declare const a: any, b: any, d: any;\nconst x = a ? (b) : c => { class K { @dec p: Foo } return K } : d;`,
  // attempt fails (no second colon): body parsed by the attempt, erased, then parsed again as the alternate
  `declare const dec: any; declare const a: any, b: any, d: any;\nconst x = a ? (b) : c => { class K { @dec p: Foo } return K };`,
  // more symbols created after the stale entry
  `declare const dec: any; declare const a: any, b: any, d: any;\nconst x = a ? (b) : (c, e, f, g) => { class K { @dec p: Foo; @dec q: Bar; @dec r: Baz } let u, v, w; return K } : d;\nfunction later(l1, l2, l3) { class Z { @dec p: Foo; @dec q: Baz } }`,
];
for (const text of cases) {
  const t = new Bun.Transpiler({ loader: "ts", target: "bun", tsconfig: { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } } });
  try { console.log(t.transformSync(text)); } catch (e) { console.log("ERR", String(e?.errors?.[0]?.message ?? e.message)); }
  console.log("-----");
}
