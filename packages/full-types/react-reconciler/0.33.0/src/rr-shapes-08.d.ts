// rr-shapes-08.d.ts: piece 8's additions (original.js 4230..4739). RR.Carried is also used by piece 4.
declare namespace RR {
  /**
   * ANYTHING AT ALL, IN A VARIABLE THAT ONLY CARRIES IT from one place to another: a context's value, this.state, this.context, what render() returned.
   * It is `unknown` spelled as a union (every primitive, and an opaque "some object or function"), so that it can stand in a union with our shapes
   * (T | any is any, T | unknown is unknown) and narrowing by assignment holds for the other members. `any` goes in without a cast, and it goes out
   * to an `any` parameter or member without one. No birth. Nothing is ever read off it.
   * AT RUN TIME CarriedObject MUST ADMIT EVERY OBJECT (an element, an array, a function, garbage).
   * THE SAME IDEA AS RR.Given (piece 9) and RR.ThrownInUnion (piece 2): the three should become one in rr-shapes.d.ts.
   * ONE OF OUR TYPES IS ASSIGNABLE TO IT: RR.Props (an index signature and no member: the checker's test for all-optional targets is skipped). So
   * `RR.Props | RR.Carried` (and RR.Props | RR.LegacyContext | RR.HostObject | RR.ClassState) does NOT narrow to RR.Props when a Props is stored.
   */
  interface CarriedObject { readonly $$rrCarried?: never }
  type Carried = CarriedObject | string | number | bigint | boolean | symbol | null | undefined;
}
