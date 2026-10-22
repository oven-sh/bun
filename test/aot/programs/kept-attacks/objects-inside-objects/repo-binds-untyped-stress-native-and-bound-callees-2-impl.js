// Objects inside objects: repo binds untyped stress native and bound callees  impl. It prints what plain Bun prints.
function shouldBe(actual, expected, what)
{
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}

function callsHostFunction(f, x) { const result = f(x); return result; }
function callsInternalFunction(f, x) { const result = f(x); return result; }
function callsBoundFunction(f, x) { const result = f(x); return result; }
function callsFunctionOfProgram(f, x) { const result = f(x); return result; }
function doubles(x) { return x * 2; }

const bound = Math.max.bind(null, 5);

function runs(count)
{
    for (let i = 0; i < count; ++i) {
        shouldBe(callsHostFunction(Number.isSafeInteger, i), true, "a host function");
        shouldBe(callsInternalFunction(String, i), String(i), "an internal function");
        shouldBe(callsBoundFunction(bound, i), i > 5 ? i : 5, "a bound function");
        shouldBe(callsFunctionOfProgram(doubles, i), i * 2, "a function of the program");
    }
}

runs(100);
console.log("passed");
