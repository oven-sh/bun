// `await using`, a switch whose arms declare, and closures over both.
const open = async (name: string): Promise<AsyncDisposable & { name: string }> => ({ name, async [Symbol.asyncDispose]() { console.log("closed", name); } });
async function stopAt(kind: string) {
  await using first = await open("first");
  let answer = () => "none";
  switch (kind) {
    case "a": { const inner = first.name + "-a"; answer = () => inner; break; }
    case "b": { using second = { [Symbol.dispose]() { console.log("second gone"); } }; const inner = first.name + "-b"; answer = () => inner + typeof second; break; }
  }
  const after = kind.length;
  return () => answer() + after;
}
for (const kind of ["a", "b", "c"]) console.log((await stopAt(kind))());
