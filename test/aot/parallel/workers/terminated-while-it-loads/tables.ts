import { build, Entry } from "./tables-part.ts";
postMessage("loading");
class Registry {
  static byName = new Map<string, Entry>();
  static filled = (() => {
    for (;;) {
      build(5000);
      for (const entry of Entry.all) Registry.byName.set(entry.name, entry);
      if (Registry.byName.size < 0) return true;
    }
  })();
}
postMessage("loaded " + Registry.filled);
