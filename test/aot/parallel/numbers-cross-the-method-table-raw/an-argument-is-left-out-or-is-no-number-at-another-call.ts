// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the form in which a number crosses a call is a matter of the calling convention: the checks read every unit against the plan
// The typed selector takes what is shown to be a number. Another call of the name hands over nothing, or a text: it goes by the boxed selector, or the parameter is no raw number at all.
interface Scale { by(factor?: number): number; plus(more: any): number }
class Inch implements Scale { by(factor = 2): number { return 2.54 * factor; } plus(more: any): number { return 1 + +more; } }
class Foot implements Scale { by(factor = 3): number { return 30.48 * factor; } plus(more: any): number { return 2 + +more; } }
class Yard implements Scale { by(factor = 4): number { return 91.44 * factor; } plus(more: any): number { return 3 + +more; } }
class Mile implements Scale { by(factor = 5): number { return 1609.344 * factor; } plus(more: any): number { return 4 + +more; } }
class Hand implements Scale { by(factor = 6): number { return 10.16 * factor; } plus(more: any): number { return 5 + +more; } }
const scales: Scale[] = [new Inch(), new Foot(), new Yard(), new Mile(), new Hand()];
let sum = 0;
for (let i = 0; i < 300; i++) { const scale = scales[i % 5]!; sum += scale.by(i) + scale.by() + scale.by(undefined) + scale.plus(i) + scale.plus("" + i) + scale.plus(null) + (i % 50 ? 0 : scale.plus({ valueOf() { return i; } })); }
console.log(sum.toFixed(3));
