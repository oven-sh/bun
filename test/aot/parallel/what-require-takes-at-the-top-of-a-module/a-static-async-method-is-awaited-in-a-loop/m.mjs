class A { static n = 7; static async m() { return this.n; } } let v = 0; for (const _ of [1, 2]) v += await A.m(); export { v };
