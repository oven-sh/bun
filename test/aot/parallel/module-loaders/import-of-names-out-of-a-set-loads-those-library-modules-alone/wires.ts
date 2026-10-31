// Wraps functions of built-in modules, and calls each once as require() gives it and once as import() gives it.
type Load = (name: string) => any;
type Owner = (global: any, load: Load) => any;

const builtin =
  (name: string, member?: string): Owner =>
  (_, load) =>
    member ? load(name)[member]?.prototype : load(name);

const table: readonly [string, Owner, string?][] = [
  ["path.", builtin("path"), "basename extname"],
  ["node:path.", builtin("node:path"), "dirname"],
  ["os.", builtin("os"), "platform"],
  ["util.", builtin("util"), "format inspect"],
  ["url.", builtin("url"), "pathToFileURL"],
  ["querystring.", builtin("querystring"), "escape"],
  ["events.EventEmitter#", builtin("events", "EventEmitter"), "listenerCount"],
  ["string_decoder.", builtin("string_decoder")],
  ["assert.", builtin("assert"), "ok"],
  ["buffer.", builtin("buffer"), "isUtf8"],
  ["punycode.", builtin("punycode"), "toASCII"],
  ["timers.", builtin("timers"), "clearTimeout"],
];

export async function install(load: Load): Promise<string[]> {
  const calls: string[] = [];
  const wrap = (inner: Function, label: string) =>
    function (this: unknown, ...args: unknown[]) {
      calls.push(label);
      return Reflect.apply(inner, this, args);
    };
  const controls = new Map<string, () => unknown>();
  const builtins = new Set<string>();
  const imported = new Map<string, any>();
  const byImport: Load = name => imported.get(name);
  const patch = ([label, owner, keys]: (typeof table)[number]) => {
    const holder = owner(globalThis, name => {
      builtins.add(name);
      return load(name);
    });
    for (const key of keys?.split(" ") ?? Object.keys(holder ?? {})) {
      if (typeof holder?.[key] !== "function") continue;
      const wrapped = wrap(holder[key], label + key);
      try {
        holder[key] = wrapped;
      } catch {}
      if (holder[key] !== wrapped) continue;
      const control = (route: Load) => () => Reflect.apply(owner(globalThis, route)[key], {}, ["a/b.c"]);
      controls.set(label + key, control(load));
      controls.set(label + key + ", by import", control(byImport));
    }
  };
  for (const row of table) patch(row);
  for (const name of builtins) {
    const namespace = await import(name);
    imported.set(name, { ...namespace.default, ...namespace });
  }
  for (const [, control] of controls) {
    try {
      control();
    } catch {}
  }
  return calls;
}
