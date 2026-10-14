// The parameter of an outer `catch` clause is thrown again and used in an inner `catch` clause.
function used(p: number) { const out: number[] = []; try { throw p + p; } catch (e1: any) { try { throw e1; } catch (e2: any) { out.push(e1); } } return out.join(); }
function added(p: number) { const out: number[] = []; try { throw p + p; } catch (e1: any) { try { throw e1; } catch (e2: any) { out.push(e1 + e2); } } return out.join(); }
function captured(p: number) { const fs: (() => number)[] = []; try { throw p + p; } catch (e1: any) { try { throw e1; } catch (e2: any) { fs.push(() => e1); } } return fs.map(f => f()).join(); }
function capturedBoth(p: number) { const fs: (() => number)[] = []; try { throw p + p; } catch (e1: any) { try { throw e1; } catch (e2: any) { fs.push(() => e1 + e2 + e2); fs.push(() => e2); } } return fs.map(f => f()).join(); }
function withClass(p: number) { const out: number[] = []; const fs: (() => number)[] = []; try { throw p + p; } catch (e1: any) { try { throw e1; } catch (e2: any) { fs.push(() => e1 + e2 + e2); } class C { f: number = e1; static s(): number { return e1 + p; } } out.push(new C().f + C.s()); } return out.join() + fs.map(f => f()).join(); }
function threeDeep(p: number) { const out: number[] = []; try { throw p; } catch (e1: any) { try { throw e1; } catch (e2: any) { try { throw e2; } catch (e3: any) { out.push(e1 + e2 + e3); } out.push(e1 + e2); } out.push(e1); } return out.join(); }
function anObject(p: number) { const out: string[] = []; try { throw new Error("x" + p); } catch (e1) { try { throw e1; } catch (e2) { out.push((e1 as Error).message, (e2 as Error).message, String(e1 === e2)); } } return out.join(); }
// These were right all along.
function anotherValue(p: number) { const out: number[] = []; try { throw p + p; } catch (e1: any) { try { throw 1; } catch (e2: any) { out.push(e1 + e2); } } return out.join(); }
function aConstant(p: number) { const out: number[] = []; const k: any = p + p; try { throw k; } catch (e2: any) { out.push(k + e2); } return out.join(); }
console.log(anotherValue(4), aConstant(4));
console.log(used(4));
console.log(added(4));
console.log(captured(4));
console.log(capturedBoth(4));
console.log(withClass(4));
console.log(threeDeep(4));
console.log(anObject(4));
