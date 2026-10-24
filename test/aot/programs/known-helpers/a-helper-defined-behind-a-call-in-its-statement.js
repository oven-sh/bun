// A helper that is defined behind a call in the statement that declares it.
function early() {
    try {
        return __classPrivateFieldIn(C, {});
    } catch (error) {
        return error.constructor.name;
    }
}
function C() {}
var first = early(), __classPrivateFieldIn = function(state, receiver) {
    if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object");
    return typeof state === "function" ? receiver === state : state.has(receiver);
};
console.log(first, early());
