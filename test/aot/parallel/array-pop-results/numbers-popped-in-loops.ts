function show(value: unknown): string {
  return `${typeof value} ${Object.is(value, -0) ? "-0" : String(value)}`;
}

function evaluate(code: number[]): unknown[] {
  const stack: number[] = [];
  const seen: unknown[] = [];
  for (let pc = 0; pc < code.length; pc++) {
    switch (code[pc]) {
      case 0:
        stack.push(code[++pc]);
        break;
      case 1: {
        const right = stack.pop()!;
        const left = stack.pop()!;
        stack.push(left + right);
        break;
      }
      case 2: {
        const right = stack.pop()!;
        const left = stack.pop()!;
        stack.push(left / right);
        break;
      }
      case 3:
        seen.push(stack.pop());
        break;
      case 4:
        seen.push(stack.shift());
        break;
    }
  }
  seen.push(stack.length);
  return seen;
}

console.log(evaluate([0, 1, 0, 2, 1, 3, 3]).map(show).join(", "));
console.log(evaluate([0, 1, 0, 3, 2, 3, 1, 3, 4]).map(show).join(", "));
console.log(evaluate([0, 2147483647, 0, 1, 1, 0, -1, 2, 3, 0, 0, 0, -1, 2, 4]).map(show).join(", "));

const holes: number[] = [1, , 3, , 5] as number[];
for (let turn = 0; turn < 6; turn++) console.log(show(holes.pop()), holes.length);

const cut: number[] = [1, 2, 3];
cut.length = 5;
for (let turn = 0; turn < 6; turn++) console.log(show(cut.shift()), cut.length);

class Pool {
  private free: { id: number }[] = [];
  private made = 0;
  take(): { id: number } {
    return this.free.pop() ?? { id: ++this.made };
  }
  give(item: { id: number }): void {
    this.free.push(item);
  }
}
const pool = new Pool();
const taken: { id: number }[] = [];
for (let turn = 0; turn < 12; turn++) {
  if (turn % 3 === 2) pool.give(taken.pop()!);
  else taken.push(pool.take());
}
console.log(taken.map(item => item.id).join());

const mixed: (number | string | undefined)[] = [];
for (let turn = 0; turn < 8; turn++) {
  mixed.push(turn);
  if (turn === 3) mixed.push("three");
  if (turn === 5) mixed[mixed.length] = undefined;
  if (turn % 2) console.log(show(mixed.pop()), show((mixed.pop() as any) + 1));
}

const kept: number[] = [4, 5, 6];
const other: any = kept;
other[1] = "text";
let sum: any = 0;
while (kept.length) sum += kept.pop()!;
console.log(show(sum));
