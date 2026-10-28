// A closure that is only passed to parameters that are only called can live on the stack of the function that creates it, together with the variables it captures.
function each(list: number[], f: (x: number) => void): void { for (let i = 0; i < list.length; i++) { f(list[i]); if (list[i] > 1e9) each(list, f); } }
function twice(f: (x: string) => string, x: string): string { if (x.length > 400) return twice(f, "cut"); return f(f(x)); }
function viaHelper(list: number[]): string { //! frame
  let total = 0;
  let text = "t";
  const seen: string[] = [];
  each(list, x => { total += x; text += x; seen.push(text); });
  return total + ":" + text + ":" + seen.length + ":" + seen[seen.length - 1];
}
function nestedHelpers(n: number): string { //! frame
  let log = "n" + n;
  return twice(s => { log += s.length; return s + log; }, "x" + n) + log.length;
}
function inLoop(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) { //! frame
    let part = "p" + i;
    each(list, x => { part += x; });
    sum += part.length;
  }
  return sum;
}
function nine(f: (a: number, b: number, c: number, d: number, e: number, g: number, h: number, i: number, j: number) => number, k: number): number {
  if (k > 1e9) return nine(f, k - 1);
  return f(k, 2, 3, 4, 5, 6, 7, 8, 9) + f(1, k, 3, 4, 5, 6, 7, 8, k);
}
function manyArguments(n: number): number { //! frame
  let sum = n;
  const f = (a: number, b: number, c: number, d: number, e: number, g: number, h: number, i: number, j: number): number => { sum += a + b * 2 + c + d + e + g + h + i + j * 3; return sum; }; //! frame
  return nine(f, n) + nine(f, n + 1);
}
function fewerThanDeclared(n: number): number { //! frame
  let sum = n;
  const take = (f: (a: number) => number): number => (n > 1e9 ? 0 : f(n));
  return each2((a?: number, b?: number) => { sum += (a ?? 100) + (b ?? 1000); return sum; }) + take(x => x);
}
function each2(f: (a?: number, b?: number) => number): number { if (data.length > 1e9) return each2(f); return f(1) + f(); }
// Handed on in two places: closure specialization leaves it alone, so the closure itself is what lies in the frame.
function twoPlaces(list: number[]): string { //! frame
  let total = 0;
  let text = "w";
  const add = (x: number): void => { total += x; text += x; }; //! frame
  each(list, add);
  each(list, add);
  return total + text;
}
const data = [1, 2, 3, 4, 5];
let out = "";
for (let i = 0; i < 300; i++) {
  const a = viaHelper(data), b = nestedHelpers(i), c = inLoop(data), d = manyArguments(i), e = fewerThanDeclared(i), g = twoPlaces(data);
  if (i % 60 === 0) out += a + "|" + b.length + "|" + c + "|" + d + "|" + e + "|" + g + "\n";
}
console.log(out);
