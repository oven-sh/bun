export let count = 1;
export function step(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? n + count : 0;
}
