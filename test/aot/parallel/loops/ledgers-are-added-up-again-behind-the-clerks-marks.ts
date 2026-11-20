// A clerk adds up a ledger column by column. Every so many lines get a mark of theirs in place of the line, and the ledger is added up again; a line that is marked gives nothing.
type Line = number[];

function ledgerOf(count: number, width: number, cents: number): Line[] {
  const lines: Line[] = [];
  for (let i = 0; i < count; i++) {
    const line: number[] = [];
    for (let j = 0; j < width; j++) line.push(i * 3 + j + cents);
    lines.push(line);
  }
  return lines;
}

function struckOut(lines: Line[], marks: any[]): string {
  const count = lines.length;
  const step = (count & 1) + 2;
  let before = 0;
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < count; i++) before += lines[i][j] | 0;
  }
  for (let k = 0; k < count; k += step) marks[k] = false;
  let after = 0;
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < count; i++) after += lines[i][j] | 0;
  }
  return before + " " + after;
}

function ticked(lines: Line[], marks: any[]): string {
  const count = lines.length;
  const step = (count & 3) + 1;
  let before = 0;
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < count; i++) before += lines[i][j] | 0;
  }
  for (let k = 1; k < count; k += step) marks[k] = true;
  let after = 0;
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < count; i++) after += lines[i][j] | 0;
  }
  return before + " " + after;
}

function marksOf(lines: Line[], marks: any[]): string {
  const count = lines.length;
  const step = (count & 3) + 2;
  let before = 0;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < count; i++) before += lines[i][j];
  }
  for (let k = 0; k < count; k += step) marks[k] = false;
  let after = 0;
  let marked = 0;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < count; i++) {
      const cents = lines[i][j];
      if (cents === undefined) marked++;
      else after += cents;
    }
  }
  return before + " " + after + " " + marked;
}

const said: string[] = [];
for (let n = 20; n < 60; n += 7) {
  for (const cents of [0, 0.5]) {
    for (const heir of [true, false]) {
      for (const count of [struckOut, ticked, marksOf]) {
        const lines = ledgerOf(n, 6, cents);
        if (heir) Object.setPrototypeOf(lines, Object.create(Array.prototype));
        said.push(count(lines, lines));
      }
      const apart = ledgerOf(n, 6, cents);
      said.push(struckOut(apart, new Array(n).fill(true)), ticked(apart, new Array(n).fill(0)), marksOf(apart, []));
    }
  }
}
for (const line of said) console.log(line);
