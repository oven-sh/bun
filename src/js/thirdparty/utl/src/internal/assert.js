class AssertionError extends Error {
    constructor(message, isForced = false) {
        super(message);
        this.name = 'AssertionError';
        this.code = 'ERR_ASSERTION';
        this.operator = '==';
        this.generatedMessage = !isForced;
        this.actual = isForced && undefined;
        this.expected = !isForced || undefined;
    }
}

function assert(p, message) {
    if (!p) throw new AssertionError(message);
}
assert.fail = function fail(message) {
    throw new AssertionError(message, true);
};

export default assert;
