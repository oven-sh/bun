// Built-ins that count their arguments: each is called with the operand left out, with `undefined` written, and with a value that is undefined in some calls and not in others.
class Weight { constructor(public grams: number) {} }
class Total { constructor(public sum: number) {} }
const weights = [new Weight(1), new Weight(2), new Weight(4)];
const add = (total: Total | Weight | undefined, weight: Weight) => new Total((total === undefined ? 100 : total instanceof Total ? total.sum : total.grams) + weight.grams);
const show = (value: unknown) => value instanceof Total ? `Total ${value.sum}` : value instanceof Weight ? `Weight ${value.grams}` : String(value);
const perhaps = <T,>(value: T, give: boolean): T | undefined => give ? value : undefined;
const ways: Record<string, (give: boolean) => unknown> = {
    reduceLeftOut: () => show((weights as (Weight | Total)[]).reduce((total, weight) => add(total, weight as Weight))),
    reduceUndefined: () => show(weights.reduce(add, undefined)),
    reducePerhaps: give => show(weights.reduce(add, perhaps(new Total(10), give))),
    reduceOfOneLeftOut: () => show([weights[0]].reduce((total: Weight) => total)),
    reduceOfOnePerhaps: give => show([weights[0]].reduce(add, perhaps(new Total(10), give))),
    reduceRightUndefined: () => show(weights.reduceRight(add, undefined)),
    reduceRightPerhaps: give => show(weights.reduceRight(add, perhaps(new Total(20), give))),
    viewLeftOut: () => new Float64Array([1, 2, 4]).reduce((sum, each) => sum + each),
    viewUndefined: () => String(new Float64Array([1, 2, 4]).reduce((sum: number | undefined, each) => (sum === undefined ? 100 : sum) + each, undefined)),
    viewPerhaps: give => String(new Float64Array([1, 2, 4]).reduce((sum: number | undefined, each) => (sum === undefined ? 100 : sum) + each, perhaps(10, give))),
    dateOfValue: () => new Date(86400000).getTime(),
    dateWithUndefinedMonth: () => String(new Date(2020, undefined as unknown as number).getTime()),
    dateWithPerhapsMonth: give => Number.isNaN(new Date(2020, perhaps(0, give) as number).getTime()),
    dateOfUndefined: () => String(new Date(undefined as unknown as number).getTime()),
    listOfLength: () => new Array(3).length,
    listOfLengthAndUndefined: () => `${new Array(3, undefined).length} ${new Array(3, undefined)[0]}`,
    listOfLengthAndPerhaps: give => `${new Array<number | undefined>(3, perhaps(7, give)).length} ${new Array<number | undefined>(3, perhaps(7, give))[1]}`,
    splitLeftOut: () => "a,b,c".split(",").length,
    splitUndefined: () => "a,b,c".split(",", undefined).length,
    splitPerhaps: give => "a,b,c".split(",", perhaps(2, give)).length,
    splitAtPatternPerhaps: give => "a,b,c".split(/,/, perhaps(1, give)).length,
    getLeftOut: () => Reflect.get({ get own() { return this === undefined ? "none" : typeof this; } }, "own"),
    getUndefined: () => Reflect.get({ get own() { "use strict"; return this === undefined ? "none" : typeof this; } }, "own", undefined),
    getPerhaps: give => Reflect.get({ get own() { "use strict"; return this === undefined ? "none" : typeof this; } }, "own", perhaps(7, give)),
    constructLeftOut: () => Reflect.construct(Total, [5]) instanceof Total,
    constructPerhaps: give => { try { return Reflect.construct(Total, [5], perhaps(Weight, give) as Function) instanceof Weight; } catch (error) { return (error as Error).constructor.name; } },
};
for (const name of Object.keys(ways)) {
    for (const give of [true, false])
        console.log(name, give, String(ways[name](give)));
}
