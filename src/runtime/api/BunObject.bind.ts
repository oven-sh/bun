import { fn, t } from "bindgen";

export const BracesOptions = t.dictionary({
  tokenize: t.boolean.default(false),
  parse: t.boolean.default(false),
});

export const braces = fn({
  args: {
    global: t.globalObject,
    input: t.DOMString,
    options: BracesOptions.default({}),
  },
  ret: t.any,
});

export const gc = fn({
  args: {
    vm: t.zigVirtualMachine,
    force: t.boolean.default(false),
  },
  ret: t.usize,
});

// Builds the macOS launchd plist body (used by `Bun.cron()` on macOS) from its
// inputs, so the log-path / XML-escaping logic can be unit-tested on any host.
// Exposed via `bun:internal-for-testing`. Throws on an invalid cron expression.
export const cronPlistForTesting = fn({
  args: {
    global: t.globalObject,
    home: t.UTF8String,
    title: t.UTF8String,
    bunExe: t.UTF8String,
    absPath: t.UTF8String,
    schedule: t.UTF8String,
  },
  ret: t.DOMString,
});
