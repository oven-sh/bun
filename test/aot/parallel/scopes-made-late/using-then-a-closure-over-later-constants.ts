// `using` in front, constants behind it, and a closure handed to a second `using` that holds them.
const held = (run: (text: string) => Promise<void>): Disposable & { run: typeof run } => ({ run, [Symbol.dispose]() { console.log("let go"); } });
const withEnv = (env: Record<string, string>): Disposable => ({ [Symbol.dispose]() { console.log("env back", Object.keys(env).join()); } });
async function driveToTheEnd({ request = "done", env = {}, hasSpoken = true, write = async () => {} }: { request?: string; env?: Record<string, string>; hasSpoken?: boolean; write?: (id: string) => Promise<void> } = {}) {
  using _env = withEnv({ A: "true", ...env });
  if (hasSpoken) console.log("spoken", request);
  const registry = new Map<string, string>([["a", "running"]]);
  const calls: string[] = [];
  const saved: string[] = [];
  using _write = held(async outcome => { calls.push(`write (row ${registry.get(outcome)})`); saved.push(outcome); await write(outcome); });
  await _write.run("a");
  return calls.join() + "|" + saved.join();
}
console.log(await driveToTheEnd());
console.log(await driveToTheEnd({ request: "other", hasSpoken: false, write: async id => { console.log("written", id); } }));
