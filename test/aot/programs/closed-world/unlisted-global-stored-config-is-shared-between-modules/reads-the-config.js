export function read(issue) { return (globalThis.__sharedConfig ??= {}).localeError?.(issue) ?? "no config"; }
