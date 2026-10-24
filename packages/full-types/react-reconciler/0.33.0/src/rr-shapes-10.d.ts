// rr-shapes-10.d.ts: piece 10's additions (checkScheduledUpdateOrContext, attemptEarlyBailoutIfNoScheduledUpdate, beginWork).
declare namespace RR {
  /**
   * EVERYTHING, SPELT AS A UNION. For a variable of the bundle's that holds one of our shapes at one time and, at another, what truly is anything
   * (beginWork's $$typeof: a RootState, a FiberRoot, a CacheComponentState .. and, in case 9, a context's value), AND THROUGH WHICH NOTHING IS READ OFF
   * THE ANYTHING: it is only carried on to a parameter that is `any`. `T | any` is any and `T | unknown` is unknown: narrowing by assignment is off.
   * `T | RR.Anything` stays a union: a store of a shape narrows to the shape; a store of an `any` leaves the whole union.
   * It is true of every value: every object satisfies AnythingObject (there is no such member), the rest are the primitives.
   * To give the idea up: `type Anything = any`: the piece still checks.
   */
  interface AnythingObject { readonly $$rrAnything?: never }
  type Anything = AnythingObject | string | number | bigint | boolean | symbol | null | undefined;

  /**
   * What beginWork goes on with behind resolveLazy (5370): Fiber.type's union less string | symbol, so that .$$typeof can be read off what is not a function.
   * A lazy that resolves to a string, a symbol or garbage is React's own error 306 ten lines further down; here it is refused at the cast.
   */
  type ResolvedLazy = Exclude<ElementType, string | symbol>;

  /**
   * beginWork's `props` (5369) and `nextProps` (5451): `any`, so NEVER IN A UNION. HERE THE UNION FAILS: each holds a fiber's pendingProps OFF WHICH MEMBERS ARE READ BY NAME
   * (props.value props.children 5725; nextProps.children 5623), or children that are CALLED (props($$typeof) 5740), or a ReactNode (RootState.element 5453 5467), and at other
   * times a shape of ours (props: ClassComponent 5431, CapturedValue 5487, Instance 5571 5604, Cache | null 5779 5810; nextProps: Cache 5457 5784, CacheComponentState 5801).
   * RR.Anything will not do: a store of an `any` leaves the whole union, and nothing can be read off that or called without a cast of the USER'S object on the hottest path.
   */
  type PropsOrChildren = any;
}
