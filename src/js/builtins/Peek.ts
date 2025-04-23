export function peek(promise: unknown): unknown {
  $assert($promiseStatePending == 0);

  return $isPromise(promise) &&
    $getPromiseInternalField(promise as Promise<unknown>, $promiseFieldFlags) & $promiseStateMask
    ? $getPromiseInternalField(promise as Promise<unknown>, $promiseFieldReactionsOrResult)
    : promise;
}

export function peekStatus(promise: unknown): string {
  $assert($promiseStatePending == 0);
  $assert($promiseStateFulfilled == 1);
  $assert($promiseStateRejected == 2);

  return ["pending", "fulfilled", "rejected"][
    $isPromise(promise) //
      ? $getPromiseInternalField(promise as Promise<unknown>, $promiseFieldFlags) & $promiseStateMask
      : 1
  ];
}
