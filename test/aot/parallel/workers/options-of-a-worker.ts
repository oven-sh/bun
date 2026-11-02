// The options of the Worker of the web as Bun has them: name, type, ref, smol, env, argv, and what process says inside.
type Facts = { name: string; argv: string[]; env: string | undefined; isMain: boolean; sum: number };
function sumOfObjects(count: number): number {
  const list: { value: number }[] = [];
  for (let i = 0; i < count; i++) list.push({ value: i });
  return list.reduce((sum, each) => sum + each.value, 0);
}
if (Bun.isMainThread) {
  const run = (what: string, options: WorkerOptions & Record<string, unknown>) =>
    new Promise<void>(resolve => {
      const worker = new Worker(new URL(import.meta.url), options);
      worker.onmessage = event => console.log(what + ":", JSON.stringify(event.data));
      worker.onerror = event => (console.log(what + ": error"), event.preventDefault());
      worker.addEventListener("close", event => (console.log(what + ": close", (event as CloseEvent).code), resolve()));
    });
  await run("nothing", {});
  await run("a name", { name: "the name" });
  await run("a module", { type: "module" });
  await run("smol", { smol: true });
  await run("no ref", { ref: false });
  await run("env", { env: { GIVEN: "given" } });
  await run("argv", { argv: ["a", "b"] });
  await run("everything", { name: "n", type: "module", smol: true, env: { GIVEN: "g" }, argv: ["x"] });
  console.log("threadId:", typeof (new Worker(new URL(import.meta.url), { ref: false }) as any).threadId);
} else {
  postMessage({ name: (globalThis as any).name ?? "", argv: process.argv.slice(2), env: process.env.GIVEN, isMain: Bun.isMainThread, sum: sumOfObjects(200_000) } satisfies Facts);
}
