import "bun:test";
beforeAll(() => () => console.log("what the hook returned has run"));
afterEach(() => console.log("laid first"));
afterEach(() => console.log("laid second"));
