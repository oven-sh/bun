export class Top { @dec m(@dec p: number) {} f = 1; static { } }
namespace N {
  export class Inner<T> extends Base<T> {
    @dec m(@dec public p: number, q = 2) { return (x: number) => x; }
    f = 1;
    [key: string]: unknown;
    static { }
    constructor(private readonly a: string) { super(); }
  }
}
declare const dec: any; declare class Base<T> {}
