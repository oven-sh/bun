export function peek(promise: unknown): unknown {
  return $isPromise(promise) && $peekPromiseStatus(promise) ? $peekPromiseSettledValue(promise) : promise;
}

export function peekStatus(promise: unknown): string {
  return ["pending", "fulfilled", "rejected"][
    $isPromise(promise) //
      ? $peekPromiseStatus(promise)
      : 1
  ];
}
