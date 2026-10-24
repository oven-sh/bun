// rr-shapes-05.d.ts: piece 5's additions (original.js 2706..3196).
declare namespace RR {
  /**
   * A HookState (a hook's state, an update's action, a store's snapshot, what an action returned, what a thenable resolved to) WHERE IT MUST STAND IN A UNION:
   * a variable that the bundle reuses, which holds one of our shapes at one time and the user's value at another (2878 pendingQueue = hook.baseState,
   * 2929 updateLane = update.action, 2998 getServerSnapshot = getServerSnapshot(), 3060 inst = inst.value, 3163 prevTransition = action(..)).
   * `HookState` is any and would swallow the union: narrowing by assignment off, every read of the HookUpdate by name. Leaving it out would be a false statement
   * about the variable. Opaque like HostObject (and like piece 2's ThrownInUnion, piece 8's Carried, piece 9's Given, piece 12's Snapshot: ONE NAME WOULD DO FOR ALL): none of our shapes is assignable
   * to HookStateObject, so narrowing by assignment holds; `any` goes in and this goes into `any` without a cast. At run time HookStateObject must admit EVERY object
   * (and function); the primitives stand beside it because useState(1) is legal.
   */
  interface HookStateObject { readonly $$rrHookState?: never }
  type HookStateInUnion = HookStateObject | string | number | bigint | boolean | symbol | null | undefined;

  /**
   * resetHooksOnUnwind (2736) stores `pending = null` to the queue of EVERY hook that has one: also to the StoreInstance of a useSyncExternalStore hook, which
   * is not born with it (10826): the object grows by a member there. IT BELONGS LAST (value, getSnapshot, pending): a merge cannot say so.
   */
  interface StoreInstance { pending?: null }

  /**
   * What `use` (2814) is given. Usable's two members with, each, the statement that it lacks the member by which the bundle knows the OTHER:
   * so `"function" === typeof usable.then` and `usable.$$typeof === REACT_CONTEXT_TYPE` are legal reads and, under strictNullChecks, the first narrows. NO BIRTH: views of given objects.
   * `then?: never`, NOT `undefined`: without strictNullChecks `undefined` says nothing: the test's false arm made usable `never`. `never` is no discriminant there: the union stays
   * whole on both arms, and the two calls carry a marked cast (under strict: from the narrowed type to itself).
   */
  interface UsableThenable extends Thenable<any> { $$typeof?: undefined }
  interface UsableContext extends ReactContext<any> { then?: never }
  type UsableGiven = UsableThenable | UsableContext;
  /** What `use` and useThenable (2797) answer: what the thenable resolved to | the context's value. any */
  type UsedValue = any;

  /** useSyncExternalStore's arguments. given */
  type StoreSubscribe = (onStoreChange: () => void) => () => void;
  type GetSnapshot = () => any;
  /** What the user dispatches to a useActionState action (a FormData, mostly): ActionStateQueueNode.payload, ActionFn's second argument. any */
  type ActionPayload = any;
}
