export function makeUntyped(options) {
  return {
    delay: 50,
    pending: 1000,
    context: undefined,
    ...options,
    strict: options.strict ?? false,
    mode: options.mode ?? "fuzzy",
    list: options.list ?? ["a"],
    limit: options.limit ?? 3,
    last: options.name ? options.name.length : -1,
  };
}
