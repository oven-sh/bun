// rr-shapes-19.d.ts: piece 19's additions (original.js 10486..11013: the module's variables, ReactSharedInternals.S, the four tables of hooks).
declare namespace RR {
  /**
   * What the callback of a transition answered (3148 3519), as ReactSharedInternals.S (10637) is given it (3151 3522). given; ANYTHING: `any`, so NEVER IN A UNION.
   * S asks it `"object" === typeof`, `null !==`, `"function" === typeof .then`, and what passes goes on as a Wakeable. `unknown` (so says SharedInternals.S) refuses
   * the read of .then behind the first two tests, and a cast to Wakeable BEFORE the third test would be false of every other object.
   */
  type TransitionResult = any;
  /**
   * RR.Reducer WHERE IT MUST STAND IN A UNION WITH RR.Dispatch: useReducer's `reducer` (10745) holds the reducer, then the HookQueue (10759), then the dispatch function (10767).
   * Reducer answers `any`, so EVERY function of at most two parameters is assignable to it, a Dispatch too: narrowing by assignment keeps Reducer beside Dispatch and
   * the result [state, dispatch] is refused. With the answer spelled as a union (piece 5's HookStateInUnion: still anything) a function that answers void is none.
   * A Reducer goes in, and this goes into a Reducer, without a cast.
   */
  type ReducerInUnion = (state: any, action: any) => HookStateInUnion;
}
