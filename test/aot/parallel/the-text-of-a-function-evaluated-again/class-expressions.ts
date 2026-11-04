// Class expressions: named, unnamed, handed over as an argument, made by a function that is called several times.
const Unnamed = class { constructor(public side: number) {} };
const Named = class Inner { constructor(readonly side: number, public again = Inner.name) {} };
function textOf(made: Function) { return String(made); }
function make(extra: number) { return class { constructor(public side: number, public more = extra) {} }; }
const evaluate = (text: string, extra?: number): any => (0, eval)("(function (extra) { return (" + text + "); })")(extra);
console.log(JSON.stringify(new (evaluate(String(Unnamed)))(1)));
console.log(JSON.stringify(new (evaluate(String(Named)))(2)));
console.log(JSON.stringify(new (evaluate(textOf(class { constructor(protected side: number) {} })))(3)));
for (let round = 0; round < 3; round++) console.log(JSON.stringify(new (evaluate(String(make(round)), round + 10))(round)));
export default class { constructor(public side = 9) {} }
