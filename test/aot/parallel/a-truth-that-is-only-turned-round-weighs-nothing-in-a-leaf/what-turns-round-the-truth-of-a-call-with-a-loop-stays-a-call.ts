// STATISTIC: CallsInlined <= 9
function some<T>(list: T[], fits: (item: T) => boolean): T | undefined {
  for (const item of list) {
    if (fits(item)) return item;
  }
  return undefined;
}
function holdsOdd(list: number[]): boolean {
  return !!some(list, item => (item & 1) === 1);
}
function report(list: number[], name: string): string {
  if (holdsOdd(list)) return name + " holds an odd number";
  return name + " holds none";
}
console.log(report([2, 4, 6], "the first"), report([2, 4, 7], "the second"), report([], "the third"));
