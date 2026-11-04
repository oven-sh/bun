// each arm behind a test hands the tested value to a function of its own. Values of every kind come out of JSON.parse and out of a list, so no call in sight shows which kind takes which arm
// Under: --aot-testing=CheckProofsAtRunTime: LinkedParameter::proven of the eight functions that the arms call
function text(v) { return "text:" + v; }
function noText(v) { return "no text:" + typeof v; }
function truthy(v) { return "truthy:" + typeof v; }
function falsy(v) { return "falsy:" + String(v); }
function dev(v) { return "dev:" + v; }
function notDev(v) { return "not dev:" + typeof v; }
function given(v) { return "given:" + typeof v; }
function zero(v) { return "zero:" + String(1 / v); }
function deed(v) {
    const first = typeof v === "string" ? text(v) : noText(v);
    const second = v ? truthy(v) : falsy(v);
    const third = v === "dev" ? dev(v) : notDev(v);
    const fourth = v === undefined ? "undefined" : given(v);
    const fifth = v === 0 ? zero(v) : "-";
    return first + " " + second + " " + third + " " + fourth + " " + fifth;
}
console.log(deed("a"), deed(1));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn & 1 ? "a" : 1);
console.log(log);
const outside = JSON.parse('["", "dev", 0, -0, 0.5, null, true, false, [], {}]');
for (let i = 0; i < outside.length; i++) console.log(deed(outside[i]));
const others = [undefined, NaN, -0, 10n, 0n, Symbol.iterator, function () { }, class { }];
for (let i = 0; i < others.length; i++) console.log(deed(others[i]));
