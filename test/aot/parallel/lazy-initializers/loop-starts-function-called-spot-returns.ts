// The start value and the condition of a loop are functions called on the spot, each with a try. The first one returns, behind its try, a constant that an inner function reads too.
function note(value: unknown): void {
  console.log("note", value);
}
function isNever<T>(value: unknown): value is T {
  return false;
}
function passThroughFalsePredicate<T>(value: T | string): T {
  if (isNever<string>(value)) return value.length as unknown as T;
  return value as T;
}

let turns = 0;
try {
  for (
    let start = (() => {
      const held: 0 | 1 = passThroughFalsePredicate<0 | 1>(0 as any);
      try {
        note((() => held)());
      } catch (error) {}
      return held as any;
    })();
    (() => {
      try {
        note((() => {})());
      } catch (error) {
        function unused(value: undefined): void {
          try {
          } catch (error) {}
        }
      }
      return turns++ < 2;
    })();
  ) {
    console.log("turn", turns, start);
  }
} catch (error) {
  console.log("caught", error);
}
