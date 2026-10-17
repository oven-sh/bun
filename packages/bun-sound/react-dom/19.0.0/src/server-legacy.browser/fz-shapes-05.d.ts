// fz-shapes-05.d.ts: carried over from 19.2.8's piece 5. In 19.0.0 the hooks stand in piece 4 (original.js 2841..3383), the request and renderElement in piece 5 (3384..4197).
declare namespace FZ {
  // GIVEN
  type MemoValue = any; // what the user's nextCreate() gave: useMemo's result, the first of MemoState
  type UsedValue = any; // what use(thenable) gives: the value the user's thenable resolved to: unwrapThenable's result
  // Request.onPostpone, the tenth parameter of RequestInstance | createRequest
  type PostponeHandler = (reason: string, postponeInfo: ThrownInfo) => void; // the user's, or noop: stored once (original.js 3478), never called in this bundle
}
