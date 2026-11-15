// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the form in which a number crosses a call is a matter of the calling convention: the checks read every unit against the plan
// STATISTIC: MethodCallsThroughTable >= 2
interface Step { stepped(sum: number): number }
class Halve implements Step { constructor(private readonly by: number) {} stepped(sum: number): number { return sum * this.by; } }
class Lower implements Step { constructor(private readonly off: number) {} stepped(sum: number): number { return sum - this.off; } }
class Raise implements Step { constructor(private readonly on: number) {} stepped(sum: number): number { return sum + this.on; } }
class Cap implements Step { constructor(private readonly top: number) {} stepped(sum: number): number { return sum < this.top ? sum : this.top; } }
class Floor implements Step { constructor(private readonly low: number) {} stepped(sum: number): number { return sum > this.low ? sum : this.low; } }
const steps: readonly Step[] = [new Halve(0.5), new Lower(3), new Raise(4), new Cap(90), new Floor(1)];
const wild: readonly Step[] = [new Halve(-0), new Lower(1 / 0), new Raise(0 / 0), new Cap(-(2 ** 31) - 1), new Floor(2 ** 53)];
function run(t: number): number {
  let sum = t & 63;
  for (let i = 0; i < 100; i++) sum = steps[i % 5]!.stepped(sum);
  return sum;
}
function stray(t: number, turns: number): number {
  let sum = t & 63;
  for (let i = 0; i < turns; i++) sum = wild[i % 5]!.stepped(sum);
  return sum;
}
let said = run(1) + " " + run(40);
for (let turns = 0; turns < 8; turns++) said += " " + stray(5, turns) + " " + Object.is(stray(5, turns), -0);
console.log(said);
