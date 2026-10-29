// The options come out of code without types. `limit === 0` holds for a number alone, whatever that code has stored, so the first arrow captures a number: a validating build must not stop here.
// Flags: --aot-validate
function report(limit: number, strict: boolean): string { return limit + " " + strict; }
function start({ limit = 0, strict = false }: { limit?: number; strict?: boolean } = {}): () => string {
  if (limit === 0) return () => report(limit, strict);
  return () => "limited " + report(limit, strict);
}
function set(target: any, path: string[], value: unknown): any {
  const key = path.shift()!;
  if (path.length > 0) target[key] = set(target[key] || {}, path, value);
  else target[key] = value;
  return target;
}
const settings = set({}, ["quota", "limit"], 0);
console.log(start(settings.quota)(), start()(), start({ limit: 3, strict: true })());
