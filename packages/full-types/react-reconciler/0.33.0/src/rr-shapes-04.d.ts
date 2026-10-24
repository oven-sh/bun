// rr-shapes-04.d.ts: piece 4's additions (original.js 2219..2705).
declare namespace RR {
  /**
   * Update.payload where it is a function: setState(updater) | replaceState(updater). given (the user's): run by .call(instance, prevState, nextProps) at 2467 2482.
   * It stands in the union of the variable that holds the payload, so that `"function" === typeof` narrows to it and .call is a call of a known function.
   */
  type StateUpdater = (this: any, prevState: any, nextProps: any) => any;
}
