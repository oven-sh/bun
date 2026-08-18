export function peek(promise: unknown): unknown {
  return $isPromise(promise) && $peekPromiseStatus(promise) ? $peekPromiseSettledValue(promise) : promise;
}

// Exposed as Bun.peek.status (BunObject.cpp constructBunPeekObject)
$overriddenName = "status";
export function peekStatus(promise: unknown): string {
  return ["pending", "fulfilled", "rejected"][
    $isPromise(promise) //
      ? $peekPromiseStatus(promise)
      : 1
  ];
}
