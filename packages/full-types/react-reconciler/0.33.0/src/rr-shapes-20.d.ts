// rr-shapes-20.d.ts: piece 20's additions (original.js 11014..11499: classComponentUpdater, the work loop's variables, exports.attemptContinuousHydration .. injectIntoDevTools).
declare namespace RR {
  /**
   * What a Cache holds for a resource type: whatever the user's function made (11078). `any`, so NEVER IN A UNION. Cache.data gives it out as `unknown`, and
   * AsyncDispatcher.getCacheForType<T> must answer a T that only the caller knows: a variable of this type stands between the two IN PLACE OF A CAST.
   * Nothing is read off it: it is compared with undefined and carried. It goes when getCacheForType is (resourceType: () => unknown): unknown.
   */
  type CacheEntry = any;
  /**
   * getFindAllNodesFailureDescription's `hostRoot` (11432 11452): first the work list (fiber, selectorIndex, fiber ..: piece 15's SelectorStackEntry), then a NEW array of
   * the names of the selectors that found nothing. ONE element type over the two births, because `hostRoot = []` fits every array type of a union, so that
   * narrowing by assignment keeps them all and no push is legal behind it.
   */
  type SelectorStackOrNames = Array<SelectorStackEntry | string>;
}
