const f = async () => ({ a: 1 }); let v; while (!v) v = (await f()).a; export { v };
