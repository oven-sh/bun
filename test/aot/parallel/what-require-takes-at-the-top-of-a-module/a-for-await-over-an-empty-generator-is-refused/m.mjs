async function* g() {} let v = 0; for await (const x of g()) v++; export { v };
