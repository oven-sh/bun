declare var $visibility: "Public" | "Private" | "PrivateRecursive";
declare function $newPromise<T = unknown>(): Promise<T>;
declare function $resolvePromise<T>(promise: Promise<T>, value: unknown): void;
declare function $rejectPromise(promise: Promise<unknown>, value: unknown): void;

// import() of a name that leads nowhere. The loader of `bun run` rejects a promise of its own, and import() resolves the promise of the program with that one:
// the program hears of the failure two jobs later.
$visibility = "Private";
export function importRejectedByLoader(reason: unknown): Promise<never> {
  const rejected = $newPromise<never>();
  $rejectPromise(rejected, reason);
  const promise = $newPromise<never>();
  $resolvePromise(promise, rejected);
  return promise;
}
