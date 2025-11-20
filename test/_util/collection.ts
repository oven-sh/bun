/**
 * Computes the Cartesian product of multiple arrays.
 *
 * @param arrays An array of arrays for which to compute the Cartesian product.
 * @returns An array containing all combinations of elements from the input arrays.
 */
export function cartesianProduct<T, U>(left: T[], right: U[]): [T, U][] {
  return left.flatMap(leftItem =>
    right.map(rightItem => [leftItem, rightItem] as [T, U])
  );
}
