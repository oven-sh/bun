// an entry is answered to whoever asks for it by its path: the program itself asks, by a name that the build does not know
export function twice(n: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? n * 2 : 0;
}
let total = 0;
for (let i = 0; i < 300; i++) total = (total + twice(i)) | 0;
if (!(globalThis as any).again) {
  (globalThis as any).again = true;
  import([Bun.main].join("")).then((got: any) => {
    console.log(total, Object.keys(got).join(), typeof got.twice, got.twice("a"));
  });
}
