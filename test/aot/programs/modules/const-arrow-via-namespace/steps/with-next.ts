export type WithNext<E, O> = {
  readonly next: (e: E, depth: never) => Promise<O>
}
