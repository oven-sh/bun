// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the form in which a number crosses a call is a matter of the calling convention: the checks read every unit against the plan
// STATISTIC: MethodCallsThroughTable >= 2
interface Valve { open(): boolean; flow(load: number): number }
class Ball implements Valve { constructor(private readonly on: boolean) {} open(): boolean { return this.on; } flow(load: number): number { return load * 0.5; } }
class Gate implements Valve { constructor(private readonly off: boolean) {} open(): boolean { return !this.off; } flow(load: number): number { return load - 3; } }
class Check implements Valve { constructor(private readonly level: number) {} open(): boolean { return this.level > 0; } flow(load: number): number { return load + this.level; } }
class Needle implements Valve { constructor(private readonly level: number) {} open(): boolean { return this.level !== 0; } flow(load: number): number { return load < this.level ? load : this.level; } }
class Relief implements Valve { constructor(private readonly left: number) {} open(): boolean { return this.left >= 1; } flow(load: number): number { return load > this.left ? load : this.left; } }
const valves: readonly Valve[] = [new Ball(true), new Gate(true), new Check(4), new Needle(90), new Relief(0.5)];
function through(i: number, load: number): number { return valves[i % 5]!.flow(load); }
let load = 17, count = 0;
for (let i = 0; i < 1000; i++) { load = through(i, load); if (valves[i % 5]!.open()) count++; }
console.log(load, count);
