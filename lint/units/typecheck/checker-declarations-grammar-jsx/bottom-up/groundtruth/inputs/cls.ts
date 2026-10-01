abstract class Base { abstract m(): void; abstract p: number; q = 1; static prototype: any; get acc() { return 1; } }
class D extends Base { q = "s"; override z() {} acc = 2; }
interface I { [k: string]: number; s: string; }
interface I2 { [k: string]: number; [k: string]: number; }
class E implements I { [k: string]: number; s = ""; }
class F { constructor(); constructor() {} constructor() {} x: number; }
class G extends (null as any as new () => { a: 1 }) { constructor() { } }
function over(a: string): void;
function over2(a: number): void {}
enum En { A, B }
enum En { C }
const enum En2 { A }
enum En2 { B = 1 }
namespace NS { export default 1; }
