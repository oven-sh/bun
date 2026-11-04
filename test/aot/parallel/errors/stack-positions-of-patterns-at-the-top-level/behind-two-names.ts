const pass = (value: unknown) => value as any;
// prettier-ignore
let data = pass(
  undefined,
), other = pass(1), [first]: number[] = data;
export { first, other };
