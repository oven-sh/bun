// an entry is answered to whoever asks for it by its path: where text is evaluated, what the entry exports is called with anything
export function twice(n: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? n * 2 : 0;
}
let total = 0;
for (let i = 0; i < 300; i++) total = (total + twice(i)) | 0;
(0, eval)("(path) => import(path)")(import.meta.path).then((got: any) => {
  console.log(total, Object.keys(got).join(), typeof got.twice, got.twice("a"));
});
