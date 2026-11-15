function show(value: any): any {
}
function work1(list: any[], count: number): any {
  const kept: any[] = list;
  let low = 0;
  let high = kept.length - 1;
  while (low < high) {
    [kept[low], kept[high]] = [kept[high], kept[low]];
    high--;
  }
}
try {
  console.log(show(work1([7, 4, 2, 3, 0, 9, 12], 2)));
} catch (error) {
  console.log("threw", (error as any).name);
}
