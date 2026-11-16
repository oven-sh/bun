// answers: without-library
// # the text of each kind of primitive as a part: -0, NaN, the infinities, exponents, the ends of int32, a BigInt, undefined and null beside a string
// # f1 = numbers, f2 = integers, f3 = flags, f4 = names, f5 = maybe, f6 = mixed
// # RUN(FORM): walk f1 f3 f4 f6 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: StringBuilderAppendNumber
// # FORM-LABEL: code f3:Body
// # FORM: StringBuilderAppendBoolean
// # FORM-LABEL: code f4:Body
// # FORM: StringBuilderAppendString
// # FORM-LABEL: code f6:Body
// # FORM: StringBuilderAppend
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 36 of 36 of 36
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function numbers(x: number, n: number) { let s = ""; for (let i = 0; i < n; i++) s += x; return s; }
function integers(from: number, n: number) { let s = ""; for (let i = from | 0; i < n; i++) s += i; return s; }
function flags(x: boolean, n: number) { let s = ""; for (let i = 0; i < n; i++) s += x; return s; }
function names(x: string, n: number) { let s = ""; for (let i = 0; i < n; i++) s += x; return s; }
function maybe(x: string | undefined | null, n: number) { let s = ""; for (let i = 0; i < n; i++) s += x; return s; }
function mixed(x: number | string | bigint | boolean | undefined | null, n: number) { let s = ""; for (let i = 0; i < n; i++) s += x; return s; }
report(numbers(1.5, 2));
report(numbers(-0, 2));
report(numbers(0, 2));
report(numbers(NaN, 2));
report(numbers(Infinity, 1));
report(numbers(-Infinity, 1));
report(numbers(1e21, 1));
report(numbers(1e-7, 1));
report(numbers(0.1 + 0.2, 1));
report(numbers(2 ** 31, 2));
report(numbers(-(2 ** 31) - 1, 1));
report(numbers(2 ** 53, 1));
report(numbers(5e-324, 1));
report(numbers(123456789012345680000, 1));
report(integers(-3, 3));
report(integers(2147483640, 2147483647));
report(integers(-2147483648, -2147483645));
report(integers(5, 5));
report(flags(true, 2));
report(flags(false, 2));
report(names("", 3));
report(names("a", 3));
report(names("Ā", 2));
report(names("a longer text that is kept by reference where the builder can", 2));
report(maybe("x", 2));
report(maybe(undefined, 2));
report(maybe(null, 2));
report(mixed(7, 2));
report(mixed(-0, 2));
report(mixed("y", 2));
report(mixed(10n, 2));
report(mixed(-(2n ** 70n), 1));
report(mixed(true, 1));
report(mixed(undefined, 1));
report(mixed(null, 1));
report("end");
