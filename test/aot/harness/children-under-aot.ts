// Preloaded into one of Bun's own test files: every `bun test` that the file starts gets `--aot`, and a byte in the file AOT_CHILDREN_STARTED counts it.
import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Options = { cmd: string[]; cwd?: string; timeout?: number; env?: Record<string, string | undefined> };

// A child that starts in the root of the repository or in test/ finds a bunfig.toml there that preloads test/preload.ts, and with it test/harness.ts. A plain run reads them in
// a moment. A compiled run compiles them each time: 20 seconds of a processor for a fixture of ten lines. Such a child gets the same configuration without the preload.
const repository = resolve(import.meta.dir, "../../..");
const withoutPreload: Record<string, string> = {
  [repository]: join(import.meta.dir, "children-in-the-root.toml"),
  [join(repository, "test")]: join(import.meta.dir, "children-in-test.toml"),
};

// A child run that never ends ends with the run that started it, however that one ends. What takes its environment from this process has it from here.
const endsWithItsParent = { BUN_FEATURE_FLAG_NO_ORPHANS: "1" };
Object.assign(process.env, endsWithItsParent);

function underAot<Start extends (...args: any[]) => any>(start: Start): Start {
  return function (this: unknown, first: string[] | Options, second?: Omit<Options, "cmd">) {
    const options: Options = Array.isArray(first) ? { ...second, cmd: first } : { ...first };
    const cmd = [...options.cmd];
    // ./run.ts puts words in front of a command.
    const bun = cmd.indexOf(process.execPath);
    if (bun < 0 || cmd[bun + 1] !== "test") return start.call(this, first, second);
    const config = withoutPreload[resolve(options.cwd ?? process.cwd())];
    const namesItsOwn = cmd.some(word => /^(?:-c|--config|--preload|-r)(?:=|$)/.test(word));
    cmd.splice(bun + 2, 0, "--aot", ...(config && !namesItsOwn ? [`--config=${config}`] : []));
    appendFileSync(process.env.AOT_CHILDREN_STARTED!, ".");
    // A file that ends a hung child after seconds gives it the time of a plain run. One that sets no limit counts on a child that ends.
    const timeout = Math.max(options.timeout ?? 0, 120_000);
    const env = { ...(options.env ?? process.env), ...endsWithItsParent };
    const child = start.call(this, { ...options, cmd, timeout, env });
    // A child that a signal ended, or that says so by its exit code, has not failed a test: it was stopped. AOT_CHILDREN_STOPPED gets a line for it.
    const note = (exitCode: number | null, signalCode: string | null | undefined) => {
      if (process.env.AOT_CHILDREN_STOPPED && (signalCode || (exitCode ?? 0) >= 128))
        appendFileSync(
          process.env.AOT_CHILDREN_STOPPED,
          `${cmd.slice(bun + 1).join(" ")}: ${signalCode ?? `exit code ${exitCode}`}\n`,
        );
    };
    if (child.exited instanceof Promise) child.exited.then((exitCode: number) => note(exitCode, child.signalCode));
    else note(child.exitCode, child.signalCode);
    return child;
  } as Start;
}

Bun.spawn = underAot(Bun.spawn);
Bun.spawnSync = underAot(Bun.spawnSync);

// `$.cwd(folder).nothrow()`${bunExe()} test ./a.test.ts``: the shell, and whatever shell one of its methods answers with or `new $.Shell()` makes.
// A proxy must answer with the very value of a property that its target has for good, as `$.Shell` is: so the target is another function.
const shellOf = new WeakMap<object, object>();
function shellUnderAot<Shell extends object>(shell: Shell): Shell {
  if (shellOf.has(shell)) return shell;
  const wrapped = (value: unknown) => (typeof value === "function" ? shellUnderAot(value) : value);
  const call = (receiver: object, args: unknown[]) =>
    Reflect.apply(shell as Function, shellOf.get(receiver) ?? receiver, args);
  const proxy = new Proxy(function () {} as unknown as Shell, {
    apply(_, receiver, args) {
      const [strings, ...values] = args;
      if (!Array.isArray(strings) || !("raw" in strings)) return wrapped(call(receiver, args));
      const starts = (at: number) => values[at - 1] === process.execPath && /^ test(?: |$)/.test(strings[at]);
      const write = (texts: readonly string[]) =>
        texts.map((text, at) => (starts(at) ? " test --aot" + text.slice(5) : text));
      for (const at of strings.keys()) if (starts(at)) appendFileSync(process.env.AOT_CHILDREN_STARTED!, ".");
      return call(receiver, [Object.assign(write(strings), { raw: write(strings.raw) }), ...values]);
    },
    construct: (_, args) => shellUnderAot(Reflect.construct(shell as new () => object, args)),
    get: (_, key) => wrapped(Reflect.get(shell, key)),
  });
  shellOf.set(proxy, shell);
  return proxy;
}

Bun.$ = shellUnderAot(Bun.$);
