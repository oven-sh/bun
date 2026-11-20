const f = async x => x * 2; let v = 0; for (let i = 0; i < 3; i++) v += await f(i); export { v };
