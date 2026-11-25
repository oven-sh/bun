import { Method, Static, Instance, Called, Callback, Rest, Spread, Listed, Property, Keyed, Mapped, Answered, Held, Deleted, Stepped, Printed } from "./kinds";
export function reads() {
  return [Method.OfMethod, Static.OfStatic, Instance.OfInstance, Called.OfCalled, Callback.OfCallback, Rest.OfRest, Spread.OfSpread, Listed.OfListed, Property.OfProperty, Keyed.OfKeyed, Mapped.OfMapped, Answered.OfAnswered, Held.OfHeld, Deleted.OfDeleted, Stepped.OfStepped, Printed.OfPrinted].join();
}
