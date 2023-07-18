// Used by async_hooks to manipulate the async context

export function getAsyncContext(): ReadonlyArray<any> | undefined {
  return $getInternalField($asyncContext, 0);
}

export function setAsyncContext(contextValue: ReadonlyArray<any> | undefined) {
  return $putInternalField($asyncContext, 0, contextValue);
}
