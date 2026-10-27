// @internal

import type Dequeue from "internal/fifo";
$linkTimeConstant;
export function createFIFO<T>(): Dequeue<T> {
  const Dequeue = require("internal/fifo");
  return new Dequeue();
}
