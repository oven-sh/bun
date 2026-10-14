// fz-shapes-05.d.ts: piece 5's additions (original.js 3256..3750: the hooks, the dispatchers, the component frames).
declare namespace FZ {
  // GIVEN
  type MemoValue = any; // what the user's nextCreate() gave: useMemo's result, the first of MemoState
  type UsedValue = any; // what use(thenable) gives: the value the user's thenable resolved to: unwrapThenable's result
  // 19.2.8: Request.onPostpone, the tenth parameter of RequestInstance | createRequest
  type PostponeHandler = (reason: string, postponeInfo: ThrownInfo) => void; // the user's, or noop: stored once (original.js 3695), never called in this bundle
}
