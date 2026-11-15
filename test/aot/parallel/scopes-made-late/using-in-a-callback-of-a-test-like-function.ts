// A callback that begins with `using`, and closures below it over what is declared later.
const it = async (name: string, run: () => Promise<void>) => { await run(); console.log("ran", name); };
const temp = (): Disposable & { path: string } => ({ path: "/t", [Symbol.dispose]() { console.log("gone"); } });
await it("a", async () => {
  using dir = temp();
  const seen: string[] = [];
  const site = { read: async (name: string) => { seen.push(dir.path + "/" + name); return name.length; } };
  let total = 0;
  for (const name of ["x", "yy"]) total += await site.read(name);
  const later = () => seen.join() + total;
  console.log(later());
});
