export function isThenable<T>(payload: PromiseLike<T> | object | {}): payload is PromiseLike<T> {
  return payload !== null && typeof payload === "object" && "then" in payload;
}
