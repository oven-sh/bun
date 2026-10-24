// A type declared inside a generic function is a different type for each type argument of the function. Only a call gives such a type: `ReturnType<typeof box<number>>` reads a result that nobody wrote, so as a written type it is unknown.
function box<T>(value: T) {
  interface Cell { value: T }
  type Wrapper = { cell: Cell };
  const wrapper: Wrapper = { cell: { value } };
  return wrapper;
}
function pair<T>(value: T) {
  type Half = { value: T };
  type Whole = { half: Half };
  const whole: Whole = { half: { value } };
  return whole;
}
box(1);
box("a");
pair(1);
pair("a");
box(2);
pair(2);
export {};
