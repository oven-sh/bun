// rr-shapes-18.d.ts: piece 18's additions (original.js 9971..10485: the births of fibers and of the root, updateContainerImpl, the module's first variables).
declare namespace RR {
  /**
   * What shouldConstruct (9971) takes: ANY FUNCTION, seen as that which has a .prototype. given. NO BIRTH: a view. FunctionComponent and ClassComponent both go in without a cast.
   * The library has Function.prototype as `any`; off the union FunctionComponent | ClassComponent it would be read as any, and the one variable that holds the function,
   * then its prototype, would not narrow. undefined: an arrow function, a method, an async function has none (9973 tests it).
   */
  interface PrototypeHolder extends Function { prototype: ClassPrototype | undefined }

  /**
   * What createFiberFromTypeAndProps (10047) is given as an element's type, BEFORE IT IS KNOWN TO BE ONE: ElementType and, beside it, EVERYTHING ELSE, spelt as a union
   * (createElement(undefined) is the commonest mistake there is: React's own error 130 is made of it at 10141, in a fiber of tag 29). It is piece 0's AnyElementType (any)
   * in a form that can stand in a union: the parameter comes to hold a Fiber (10083 ..), and `any` would swallow that.
   * TypeObjectGiven: some object that is none of ours; the bundle reads $$typeof off it (10122) to find out: hence that one member, optional. At run time it must admit
   * EVERY object. No shape of ours but the five of ElementType has a member in common with it, so a Fiber is not assignable to it and narrowing by assignment holds.
   */
  interface TypeObjectGiven { $$typeof?: unknown }
  type ElementTypeGiven = ElementType | TypeObjectGiven | number | bigint | boolean | undefined;
}
