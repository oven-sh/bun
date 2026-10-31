function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
let kept;
function keep(value) { kept = value; return value; }
noInline(keep);

function onlyCalled() {
    function sumOnlyCalled(n) { return n <= 0 ? 0 : n + sumOnlyCalled(n - 1); }
    return sumOnlyCalled(4) + sumOnlyCalled.length;
}
check(onlyCalled(), 11, "a function that is only called");

function isStoredInProperty(o) {
    function sumStored(n) { return n <= 0 ? 0 : n + sumStored(n - 1); }
    o.sum = sumStored;
    return sumStored(4);
}
check(isStoredInProperty({ }), 10, "a function stored in a property");

function isStoredInElement(list, i) {
    function sumInElement(n) { return n <= 0 ? 0 : n + sumInElement(n - 1); }
    list[i] = sumInElement;
    return sumInElement(4);
}
check(isStoredInElement([], 0), 10, "a function stored in an element");

function isPassed() {
    function sumPassed(n) { return n <= 0 ? 0 : n + sumPassed(n - 1); }
    keep(sumPassed);
    return sumPassed(4);
}
check(isPassed(), 10, "a function passed to a function that is not known");

function isReturned() {
    function sumReturned(n) { return n <= 0 ? 0 : n + sumReturned(n - 1); }
    sumReturned(4);
    return sumReturned;
}
check(isReturned()(4), 10, "a function that is returned");

function isConstructed() {
    function sumConstructed(n) { return n <= 0 ? 0 : n + sumConstructed(n - 1); }
    new sumConstructed(0);
    return sumConstructed(4);
}
check(isConstructed(), 10, "a function that is constructed");

function hasItsPrototypeRead() {
    function sumWithPrototype(n) { return n <= 0 ? 0 : n + sumWithPrototype(n - 1); }
    sumWithPrototype.prototype.method = 1;
    return sumWithPrototype(4);
}
check(hasItsPrototypeRead(), 10, "a function whose prototype is read");

function isLeftOfInstanceof() {
    function sumLeft(n) { return n <= 0 ? 0 : n + sumLeft(n - 1); }
    return sumLeft(4) + (sumLeft instanceof Function ? 1 : 0);
}
check(isLeftOfInstanceof(), 11, "a function left of instanceof");

function isRightOfInstanceof(value) {
    function sumRight(n) { return n <= 0 ? 0 : n + sumRight(n - 1); }
    return sumRight(4) + (value instanceof sumRight ? " yes" : " no");
}
function arrowIsRightOfInstanceof(value) {
    const sumArrowRight = n => n <= 0 ? 0 : n + sumArrowRight(n - 1);
    return sumArrowRight(4) + (value instanceof sumArrowRight ? " yes" : " no");
}
function thrownBy(f, ...parameters) {
    try {
        f(...parameters);
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}
check(isRightOfInstanceof({ }), "10 no", "a function right of instanceof");
check(thrownBy(arrowIsRightOfInstanceof, { }), "TypeError", "an arrow function right of instanceof");

function hasProperties() {
    function sumWithProperties(n) { return n <= 0 ? 0 : n + sumWithProperties(n - 1); }
    sumWithProperties.displayName = "sum";
    return sumWithProperties(4) + sumWithProperties.displayName + sumWithProperties.other;
}
check(hasProperties(), "10sumundefined", "a function with properties");

function hasPropertiesAndIsPassed() {
    function sumWithBoth(n) { return n <= 0 ? 0 : n + sumWithBoth(n - 1); }
    sumWithBoth.displayName = "sum";
    keep(sumWithBoth);
    return sumWithBoth(4);
}
check(hasPropertiesAndIsPassed(), 10, "a function with a property that is also passed");

function changesItsChain() {
    function sumReparented(n) { return n <= 0 ? 0 : n + sumReparented(n - 1); }
    sumReparented.__proto__ = null;
    return sumReparented(4);
}
check(changesItsChain(), 10, "a function that gets another prototype");

function isReadByValue(key) {
    function sumByValue(n) { return n <= 0 ? 0 : n + sumByValue(n - 1); }
    return sumByValue(4) + String(sumByValue[key]);
}
check(isReadByValue("nothing"), "10undefined", "a function that is read by value");

function isMerged(which) {
    function sumFirst(n) { return n <= 0 ? 0 : n + sumFirst(n - 1); }
    function sumSecond(n) { return n <= 0 ? 1 : n + sumSecond(n - 1); }
    let either = which ? sumFirst : sumSecond;
    return either(4);
}
check(isMerged(true) + isMerged(false), 21, "one of two functions");
console.log("passed");
