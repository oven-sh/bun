// ECMAScript forbids the tokens `for (async of`, in and outside an await context. TypeScript forbids the name `async` there, however it is written, outside an await context only.
declare let async: any;
for (async of []) {}
async function f() { for (async of []) {} }
for await (async of []) {}
for (\u0061sync of []) {}
export {};
