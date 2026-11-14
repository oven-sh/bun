// Prints where an operator throws, or calls what throws, if its value is kept in a variable that is used once: `bun run` evaluates such a value where the variable is named, among the operators that stand there.
function show(run) {
  try {
    run();
    console.log(run.name + " no error");
  } catch (error) {
    const frames = String(error.stack).split("\n").slice(1, 3);
    console.log(run.name + " " + error.constructor.name + " " + frames.map(line => line.replace(/.*:(\d+:\d+)\)?$/, "$1")).join(" < "));
  }
}
function fail() {}
const thrower = { valueOf() { throw new Error("converted"); } };
const amount = [10n][0], rate = [2][0], base = [1][0], list = [1, 2];
show(function productRight() { const fee = amount * rate; return base + fee; });
show(function productLeft() { const fee = amount * rate; return fee + base; });
show(function sumRight() { const fee = amount + rate; return base * fee; });
show(function sumLeft() { const fee = amount + rate; return fee * base; });
show(function sumOfSum() { const fee = amount + rate; return base + fee; });
show(function converted() { const fee = thrower * rate; return base + fee; });
show(function convertedRight() { const fee = rate * thrower; return base - fee; });
show(function twoSteps() { const fee = amount * rate; const total = base + fee; return base - total; });
show(function twoStepsTight() { const fee = amount ** rate; const total = base * fee; return base + total; });
show(function compared() { const fee = amount * rate; return base < fee; });
show(function argument() { const fee = (amount + rate) * base; return String(base, fee); });
show(function element() { const fee = (amount + rate) * base; return [base, fee]; });
show(function inTemplate() { const fee = (amount + rate) * base; return `${base}${fee}`; });
show(function assigned() { let kept; const fee = (amount + rate) * base; kept = fee; return kept; });
show(function negated() { const fee = (amount + rate) * base; return -fee; });
show(function member() { const fee = (amount + rate).x * base; return base + fee; });
show(function condition() { const fee = amount * rate; if (base + fee) return 1; });
show(function thrown() { const fee = (amount + rate) * base; throw fee; });
show(function typed() { const fee = amount * rate; return base + (fee); });
show(function logical() { const fee = amount * rate; return base && fee; });
show(function conditional() { const fee = amount * rate; return base ? fee : 0; });
show(function comma() { const fee = amount * rate; return (base, fee); });
show(function usedTwice() { const fee = amount * rate; return fee + fee; });
show(function inLoop() { for (const item of list) { const fee = amount * item; return base + fee; } });
show(function withLet() { let fee = amount * rate; return base + fee; });
show(function relation() { const fee = amount + rate; return "a" in fee; });
show(function instance() { const fee = amount + rate; return base instanceof fee; });
show(function onePlus() { const fee = amount * rate; return 1 + fee; });
show(function twoTimes() { const fee = amount + rate; return 2 * fee; });
show(function textPlus() { const fee = thrower * rate; return "total: " + fee; });
show(function textPlusSum() { const fee = thrower + rate; return "total: " + fee; });
show(function bigMinus() { const fee = amount * rate; return 100n - fee; });
show(function lessThan() { const fee = amount * rate; return 0 < fee; });
show(function steps() { const fee = amount * rate; const more = 1 + fee; return 2 - more; });
show(function stepsInParentheses() { const fee = amount + rate; const more = 2 * fee; return 1 + more; });
show(function nothingPlus() { const fee = amount * rate; return null + fee; });
show(function templateJoined() { const fee = thrower * rate; return `total: ${fee}`; });
show(function shifted() { const fee = amount + rate; return 1 << fee; });
show(function power() { const fee = amount * rate; return 2 ** fee; });
show(function bigIntRightOfIn() { fail(); const a = 2n; const b = a + 1; return 1 in b; });
show(function bigIntThroughTwoNames() { const a = 2n; const b = a + 1; const c = b; return 1 instanceof c; });
show(function bigIntDivided() { const a = 0n; const c = a / a; return 1 instanceof c; });
show(function testThatHoldsAndIsKept() { const a = undefined; const b = a + 1; const c = typeof b; const d = c ? "x" : undefined; throw d(); });
show(function testThatHoldsBehindOr() { fail(); const a = false; const b = a ** (void 0); const c = b || `t`; const d = c ? "y" : false; return (-d)(); });
show(function emptyTextOnTheRight() { const a = undefined; const b = a ? "x" : true; const c = b > 0; const d = `${c}y`; const e = d + ""; return ("t" + e)(); });
show(function emptyTextOnTheLeft() { fail(); const a = ""; const b = a + "é"; return 1 instanceof b; });
