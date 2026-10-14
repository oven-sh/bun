// rr-shapes-06.d.ts: piece 6's additions (original.js 3197..3685: action state, effects, memo, deferred value, transitions, dispatch).

// f.apply(thisArg, arguments) (3408 10909): the library's strict `apply` takes an array only; the language takes an arguments object too.




declare namespace RR {
  /** What useMemo | useCallback keep in Hook.memoizedState. births 3450 3468 10707 10740 (array literals stored to an `any` field) */
  type MemoizedPair<T = any> = [value: T, deps: HookDeps | null];
  /** The state of a form's second hook. births 3576 11549: BORN EMPTY AND STAYS SO: only its identity says anything */
  interface FormResetState {}
}
