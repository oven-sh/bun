declare function dec(...args: any[]): any;
declare function bad(): void;
@dec class A {
    @dec m() {}
    @bad p = 1;
    @dec accessor q = 2;
    constructor(@dec x: number) {}
}
@dec function notAllowed() {}
class B { @dec get g() { return 1; } @dec set g(v) {} }
