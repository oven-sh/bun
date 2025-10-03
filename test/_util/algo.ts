/** Python's zip. Does not bounds checking. Very simplistic. */
export function zip<T1, T2>(a: T1[], b: T2[]): [T1, T2][] {
  return a.map((k, i) => [k, b[i]] as [T1, T2]);
}
