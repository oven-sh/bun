// A helper that is defined behind a call in its own initializer.
function early() {
    try {
        return __classPrivateFieldIn(C, {});
    } catch (error) {
        return error.constructor.name;
    }
}
function C() {}
var first;
var __classPrivateFieldIn = (first = early(), function(state, receiver) {
    if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object");
    return typeof state === "function" ? receiver === state : state.has(receiver);
});
console.log(first, early());
