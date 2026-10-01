const tr = new Bun.Transpiler({ loader: "ts" });
for (const code of process.argv.slice(2)) {
  try {
    console.log(JSON.stringify(code), "=>", JSON.stringify(tr.transformSync(code)));
  } catch (e) {
    console.log(JSON.stringify(code), "ERR", e?.name, JSON.stringify(e?.message), e?.errors?.map(x => x.message));
  }
}
