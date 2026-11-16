async function* g() {} let v = 0; for await (const x of { [Symbol.asyncIterator]: () => g() }) v++; export { v };
