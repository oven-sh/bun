// fz-shapes-05.d.ts: carried over from 19.1.0's piece 5. IN THIS VERSION THE TWO NAMES ARE USED BY PIECE 4 (useMemo 3029, unwrapThenable 3138); piece 5 (original.js 3470..4225: RequestInstance to renderElement) adds no name of its own.
declare namespace FZ {
  // GIVEN
  type MemoValue = any; // what the user's nextCreate() gave: useMemo's result, the first of MemoState
  type UsedValue = any; // what use(thenable) gives: the value the user's thenable resolved to: unwrapThenable's result
}
