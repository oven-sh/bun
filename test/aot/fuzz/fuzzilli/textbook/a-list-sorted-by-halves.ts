function sorted(list: number[]): number[] {
  if (list.length < 2) return list;
  const middle = list.length >> 1;
  const left = sorted(list.slice(0, middle));
  const right = sorted(list.slice(middle));
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (j >= right.length || (i < left.length && left[i] <= right[j])) out.push(left[i++]);
    else out.push(right[j++]);
  }
  return out;
}
console.log(sorted(JSON.parse("[5,2,9,1,5,6,0]")).join());
