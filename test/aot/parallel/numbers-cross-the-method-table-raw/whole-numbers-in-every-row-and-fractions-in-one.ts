// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the form in which a number crosses a call is a matter of the calling convention: the checks read every unit against the plan
interface Count { of(at: number): number; mixed(at: number): number }
class Ones implements Count { of(at: number): number { return (at + 1) | 0; } mixed(at: number): number { return (at + 1) | 0; } }
class Twos implements Count { of(at: number): number { return (at * 2) | 0; } mixed(at: number): number { return (at * 2) | 0; } }
class Threes implements Count { of(at: number): number { return (at * 3) | 0; } mixed(at: number): number { return at / 3; } }
class Fours implements Count { of(at: number): number { return (at >> 2) | 0; } mixed(at: number): number { return (at >> 2) | 0; } }
class Fives implements Count { of(at: number): number { return (at ^ 5) | 0; } mixed(at: number): number { return (at ^ 5) | 0; } }
const counts: Count[] = [new Ones(), new Twos(), new Threes(), new Fours(), new Fives()];
let whole = 7, mixed = 7;
for (let i = 0; i < 500; i++) { whole = counts[i % 5]!.of(whole + i); mixed = counts[(i + 2) % 5]!.mixed(mixed + i) % 100003; }
console.log(whole, mixed, counts[1]!.of(2 ** 30), counts[1]!.of(2 ** 31), counts[2]!.of(-0.5), Object.is(counts[2]!.mixed(-0), -0));
