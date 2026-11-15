// A call that only stores a list, or only reads it, writes neither its length nor its storage: the build ended under proof-checks. One that does is seen.
const state = { sum: 0, list: [1e3] as any[], at: 0 };
const fixed: any[] = [1, "two", 3.5, null];
const numbers: number[] = [5, 6, 7, 8];
function stores(list: any, turn: any): void { if (turn === 2) state.list = list; }
function reads(list: any[], turn: number): void { state.at = list.length + turn; }
function grows(list: any[], turn: number): void { if (turn === 1 && list.length < 7) list.push(turn, "grown"); }
function cuts(list: any[], turn: number): void { if (turn === 2) list.length = 3; }
function storing(): string {
  let seen = "";
  for (let i = 1; i < fixed.length; i++) { stores(fixed, i); const one = fixed[i]; seen += String(one) + ";"; }
  return seen;
}
function reading(): number {
  let sum = 0;
  for (let i = 0; i < numbers.length; i++) { reads(numbers, i); sum += numbers[i] + state.at; }
  return sum;
}
function growing(list: any[]): string {
  let seen = "";
  for (let i = 0; i < list.length; i++) { grows(list, i); seen += String(list[i]) + ";"; }
  return seen;
}
function cutting(list: any[]): string {
  let seen = "";
  for (let i = 0; i < list.length; i++) { cuts(list, i); seen += String(list[i]) + ";"; }
  return seen;
}
function written(): string {
  for (let i = 0; i < numbers.length; i++) { stores(numbers, i); numbers[i] = numbers[i] * 2; state.list[0] = -1; }
  return numbers.join() + state.list.length;
}
for (let round = 0; round < 2; round++) console.log(storing(), reading(), growing([1, 2, 3]), cutting([1, 2, 3, 4, 5]), written(), state.list === numbers, state.at);
export {};
