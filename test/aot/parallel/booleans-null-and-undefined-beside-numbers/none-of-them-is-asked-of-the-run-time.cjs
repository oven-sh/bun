'use strict';
// COUNT: operation:operationAOTValueMul <= 20
// COUNT: operation:operationAOTValueSub <= 20
// COUNT: operation:operationAOTValueDiv <= 20
// COUNT: operation:operationAOTValueMod <= 20
// COUNT: operation:operationAOTValueAdd <= 20
// COUNT: operation:operationAOTCompareLess <= 20
// COUNT: operation:operationAOTCompareLessEq <= 20
// COUNT: operation:operationAOTCompareGreater <= 20
// COUNT: operation:operationAOTCompareGreaterEq <= 20
// true, false, null and nothing stand on either side of each operator, beside a whole number, a fraction and one another, through functions that know neither side: 2,646 operations, each held against the rule written out by hand.
const z = JSON.parse('0'), any = x => [x][z];
const given = [true, false, null, undefined, 3, -0.5, 0];
const T = {
    plus(x, y) { return x + y; }, minus(x, y) { return x - y; }, times(x, y) { return x * y; }, over(x, y) { return x / y; }, rest(x, y) { return x % y; },
    less(x, y) { return x < y; }, lessEq(x, y) { return x <= y; }, greater(x, y) { return x > y; }, greaterEq(x, y) { return x >= y; },
};
const number = x => x === undefined ? NaN : x === true ? 1 : x === false || x === null ? 0 : x;
const rule = {
    plus: (x, y) => number(x) + number(y), minus: (x, y) => number(x) - number(y), times: (x, y) => number(x) * number(y), over: (x, y) => number(x) / number(y), rest: (x, y) => number(x) % number(y),
    less: (x, y) => number(x) < number(y), lessEq: (x, y) => number(x) <= number(y), greater: (x, y) => number(x) > number(y), greaterEq: (x, y) => number(x) >= number(y),
};
const names = JSON.parse('["plus","minus","times","over","rest","less","lessEq","greater","greaterEq"]');
let wrong = 0, done = 0; const seen = [];
for (let round = 0; round < 6; round++) for (const name of names) for (const x of given) for (const y of given) {
    const got = T[any(name)](any(x), any(y)); done++;
    if (!Object.is(got, rule[name](x, y))) wrong++;
    if (!round) seen.push(Object.is(got, -0) ? '-0' : String(got));
}
console.log(done, wrong); console.log(seen.join());
