// A cast in front of a function expression starts where the stores of the parameter properties are added: both stand in the text.
const tally = { calls: 0 };
// prettier-ignore
class Tight{constructor(public held:number){<void>function(){tally.calls++}()}}
// prettier-ignore
class Under extends Tight{constructor(public more:number){super(more);<void>function(){tally.calls+=10}()}}
const AgainTight = (0, eval)("(function (tally) { return (" + String(Tight) + "); })")(tally);
const AgainUnder = (0, eval)("(function (Tight, tally) { return (" + String(Under) + "); })")(AgainTight, tally);
console.log(JSON.stringify(new Tight(1)), JSON.stringify(new AgainTight(2)), JSON.stringify(new Under(3)), JSON.stringify(new AgainUnder(4)), tally.calls);
