// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the form in which a number crosses a call is a matter of the calling convention: the checks read every unit against the plan
// STATISTIC: MethodCallsThroughTable = 0
// The call in the loop hands every row a whole number. A call of its own hands one row a fraction: that body takes a double, the others an int32, and the selector takes what holds both.
interface Tick { ticked(by: number): number }
class First implements Tick { constructor(private at: number) {} ticked(by: number): number { this.at = (this.at + by) | 0; return this.at; } }
class Second implements Tick { constructor(private at: number) {} ticked(by: number): number { this.at = this.at + by; return this.at; } }
class Third implements Tick { constructor(private at: number) {} ticked(by: number): number { this.at = (this.at ^ by) | 0; return this.at; } }
class Fourth implements Tick { constructor(private at: number) {} ticked(by: number): number { this.at = (this.at - by) | 0; return this.at; } }
class Fifth implements Tick { constructor(private at: number) {} ticked(by: number): number { this.at = (this.at + (by << 1)) | 0; return this.at; } }
const lone = new Second(1);
const ticks: readonly Tick[] = [new First(1), lone, new Third(3), new Fourth(4), new Fifth(5)];
let sum = 0;
for (let i = 0; i < 500; i++) sum = (sum + ticks[i % 5]!.ticked(i)) % 1000003;
const half = lone.ticked(0.5);
for (let i = 0; i < 500; i++) sum = (sum + ticks[i % 5]!.ticked(i)) % 1000003;
console.log(sum, half, lone.ticked(-0.25));
