type T = {}

function throwError() {
    throw new Error("Test error from line 4");
}

console.log("Starting test");
throwError();