// <bun under test> meta.mjs <sources...> : the metadata calls with emitDecoratorMetadata
const DECO = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
const t = new Bun.Transpiler({ loader: "ts", tsconfig: DECO });
const { bunMetadataOf } = await import("/tmp/gdr1b/gd/causes.mjs");
for (const src of process.argv.slice(2)) {
  let out;
  try { out = JSON.stringify(bunMetadataOf(t.transformSync(src))); } catch (e) { out = "ERROR " + (e.errors?.[0]?.message ?? e.message); }
  console.log(JSON.stringify(src), "\n    ", Bun.revision.slice(0, 9), out);
}
