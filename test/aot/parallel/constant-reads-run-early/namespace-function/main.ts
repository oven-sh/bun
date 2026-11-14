var log: any[] = [];
namespace N { export function f() { return read(); } }
log.push(N.f());

var MAX = "_max";
function read(): any { try { return MAX === undefined ? "early" : MAX; } catch (e: any) { return e.name; } }
function store(o: any) { try { o[MAX] = 1; } catch (e: any) { o.failed = e.name; } return Object.keys(o).join(); }
class Box { constructor() { try { (this as any)[MAX] = 2; } catch (e: any) { (this as any).failed = e.name; } } get keys() { return Object.keys(this).join(); } }
console.log(log.join(" "), read(), store({}), new Box().keys);
