export let count = 1;
export function bump(by) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  count = (count + by + work) | 0;
  return count;
}
