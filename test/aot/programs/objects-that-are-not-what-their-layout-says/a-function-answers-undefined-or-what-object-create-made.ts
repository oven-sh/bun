interface Options { depth: number }
const real: Options = { depth: 2 };
function pick(flag: boolean): Options | undefined { return flag ? (Object.create({ depth: 9 }) as Options) : undefined; }
function depthOf(o: Options | undefined): number { return o ? o.depth : -1; }
console.log(depthOf(pick(Date.now() < 0)), depthOf(pick(Date.now() > 0)), depthOf(real));
