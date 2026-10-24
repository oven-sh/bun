// Objects with eighteen to twenty-three optional numbers are filled in two arms of a switch that meet, handed back and summed.
type Wide18 = { name: string; a00?: number; a01?: number; a02?: number; a03?: number; a04?: number; a05?: number; a06?: number; a07?: number; a08?: number; a09?: number; a10?: number; a11?: number; a12?: number; a13?: number; a14?: number; a15?: number; a16?: number; a17?: number; };
function make18(i: number): Wide18 {
  const next: Wide18 = { name: "n" + i };
  switch (i % 4) {
    case 0:
      next.a00 = i * 2 + 0;
      next.a01 = i * 2 + 1;
      next.a02 = i * 2 + 2;
      next.a03 = i * 2 + 3;
      next.a04 = i * 2 + 4;
      next.a05 = i * 2 + 5;
      next.a06 = i * 2 + 6;
      next.a07 = i * 2 + 7;
      next.a08 = i * 2 + 8;
    case 2:
      next.a09 = i * 2 + 0;
      next.a10 = i * 2 + 1;
      next.a11 = i * 2 + 2;
      next.a12 = i * 2 + 3;
      next.a13 = i * 2 + 4;
      next.a14 = i * 2 + 5;
      next.a15 = i * 2 + 6;
      next.a16 = i * 2 + 7;
      next.a17 = i * 2 + 8;
  }
  return next;
}
function sum18(o: Wide18): number {
  let n = 0;
  n += o.a00 ?? 0;
  n += o.a01 ?? 0;
  n += o.a02 ?? 0;
  n += o.a03 ?? 0;
  n += o.a04 ?? 0;
  n += o.a05 ?? 0;
  n += o.a06 ?? 0;
  n += o.a07 ?? 0;
  n += o.a08 ?? 0;
  n += o.a09 ?? 0;
  n += o.a10 ?? 0;
  n += o.a11 ?? 0;
  n += o.a12 ?? 0;
  n += o.a13 ?? 0;
  n += o.a14 ?? 0;
  n += o.a15 ?? 0;
  n += o.a16 ?? 0;
  n += o.a17 ?? 0;
  return n;
}
type Wide20 = { name: string; a00?: number; a01?: number; a02?: number; a03?: number; a04?: number; a05?: number; a06?: number; a07?: number; a08?: number; a09?: number; a10?: number; a11?: number; a12?: number; a13?: number; a14?: number; a15?: number; a16?: number; a17?: number; a18?: number; a19?: number; };
function make20(i: number): Wide20 {
  const next: Wide20 = { name: "n" + i };
  switch (i % 4) {
    case 0:
      next.a00 = i * 2 + 0;
      next.a01 = i * 2 + 1;
      next.a02 = i * 2 + 2;
      next.a03 = i * 2 + 3;
      next.a04 = i * 2 + 4;
      next.a05 = i * 2 + 5;
      next.a06 = i * 2 + 6;
      next.a07 = i * 2 + 7;
      next.a08 = i * 2 + 8;
      next.a09 = i * 2 + 9;
    case 2:
      next.a10 = i * 2 + 0;
      next.a11 = i * 2 + 1;
      next.a12 = i * 2 + 2;
      next.a13 = i * 2 + 3;
      next.a14 = i * 2 + 4;
      next.a15 = i * 2 + 5;
      next.a16 = i * 2 + 6;
      next.a17 = i * 2 + 7;
      next.a18 = i * 2 + 8;
      next.a19 = i * 2 + 9;
  }
  return next;
}
function sum20(o: Wide20): number {
  let n = 0;
  n += o.a00 ?? 0;
  n += o.a01 ?? 0;
  n += o.a02 ?? 0;
  n += o.a03 ?? 0;
  n += o.a04 ?? 0;
  n += o.a05 ?? 0;
  n += o.a06 ?? 0;
  n += o.a07 ?? 0;
  n += o.a08 ?? 0;
  n += o.a09 ?? 0;
  n += o.a10 ?? 0;
  n += o.a11 ?? 0;
  n += o.a12 ?? 0;
  n += o.a13 ?? 0;
  n += o.a14 ?? 0;
  n += o.a15 ?? 0;
  n += o.a16 ?? 0;
  n += o.a17 ?? 0;
  n += o.a18 ?? 0;
  n += o.a19 ?? 0;
  return n;
}
type Wide23 = { name: string; a00?: number; a01?: number; a02?: number; a03?: number; a04?: number; a05?: number; a06?: number; a07?: number; a08?: number; a09?: number; a10?: number; a11?: number; a12?: number; a13?: number; a14?: number; a15?: number; a16?: number; a17?: number; a18?: number; a19?: number; a20?: number; a21?: number; a22?: number; };
function make23(i: number): Wide23 {
  const next: Wide23 = { name: "n" + i };
  switch (i % 4) {
    case 0:
      next.a00 = i * 2 + 0;
      next.a01 = i * 2 + 1;
      next.a02 = i * 2 + 2;
      next.a03 = i * 2 + 3;
      next.a04 = i * 2 + 4;
      next.a05 = i * 2 + 5;
      next.a06 = i * 2 + 6;
      next.a07 = i * 2 + 7;
      next.a08 = i * 2 + 8;
      next.a09 = i * 2 + 9;
      next.a10 = i * 2 + 10;
    case 2:
      next.a11 = i * 2 + 0;
      next.a12 = i * 2 + 1;
      next.a13 = i * 2 + 2;
      next.a14 = i * 2 + 3;
      next.a15 = i * 2 + 4;
      next.a16 = i * 2 + 5;
      next.a17 = i * 2 + 6;
      next.a18 = i * 2 + 7;
      next.a19 = i * 2 + 8;
      next.a20 = i * 2 + 9;
      next.a21 = i * 2 + 10;
      next.a22 = i * 2 + 11;
  }
  return next;
}
function sum23(o: Wide23): number {
  let n = 0;
  n += o.a00 ?? 0;
  n += o.a01 ?? 0;
  n += o.a02 ?? 0;
  n += o.a03 ?? 0;
  n += o.a04 ?? 0;
  n += o.a05 ?? 0;
  n += o.a06 ?? 0;
  n += o.a07 ?? 0;
  n += o.a08 ?? 0;
  n += o.a09 ?? 0;
  n += o.a10 ?? 0;
  n += o.a11 ?? 0;
  n += o.a12 ?? 0;
  n += o.a13 ?? 0;
  n += o.a14 ?? 0;
  n += o.a15 ?? 0;
  n += o.a16 ?? 0;
  n += o.a17 ?? 0;
  n += o.a18 ?? 0;
  n += o.a19 ?? 0;
  n += o.a20 ?? 0;
  n += o.a21 ?? 0;
  n += o.a22 ?? 0;
  return n;
}
for (let i = 0; i < 4; i++) console.log(sum18(make18(i)), sum20(make20(i)), sum23(make23(i)));
