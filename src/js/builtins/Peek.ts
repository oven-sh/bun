export function peek(promise: unknown): unknown {
  $assert($promiseStatePending == 0);

  return $isPromise(promise) && $getPromiseInternalField(promise, $promiseFieldFlags) & $promiseStateMask
    ? $getPromiseInternalField(promise, $promiseFieldReactionsOrResult)
    : promise;
}

export function peekStatus(promise: unknown): string {
  $assert($promiseStatePending == 0);
  $assert($promiseStateFulfilled == 1);
  $assert($promiseStateRejected == 2);

  return ["pending", "fulfilled", "rejected"][
    $isPromise(promise) //
      ? $getPromiseInternalField(promise, $promiseFieldFlags) & $promiseStateMask
      : 1
  ];
}
