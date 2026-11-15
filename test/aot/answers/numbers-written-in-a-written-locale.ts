// answers: with-library
// # numbers of every kind are written in a locale that is written, with and without written options; the receiver is a number, a Number object, a BigInt; and a formatter is made of a written locale and written options
// # f1 = plain, f7 = formatter, f6 = tell
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:
// # FORM: = FormatNumberWithPattern
// # RUN(MADE): walk f7 mechanisms=all
// # MADE-LABEL: code f7:
// # MADE: = NewFormatterWithPattern
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 66 of 66 of 66
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function plain(n: number) { return n.toLocaleString("en-US"); }
function german(n: number) { return n.toLocaleString("de-DE"); }
function percent(n: number) { return n.toLocaleString("en-US", { style: "percent" }); }
function digits(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function badLocale(n: number) { return n.toLocaleString("not a locale"); }
function formatter() { return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }); }
function tell(f: (n: number) => string, n: unknown) { try { report(f(n as number)); } catch (e) { report((e as Error).name); } }
function all(n: unknown) { tell(plain, n); tell(german, n); tell(percent, n); tell(digits, n); tell(badLocale, n); }
all(0);
all(-0);
all(1234.5678);
all(-1);
all(1e21);
all(2 ** 53 + 2);
all(1e-7);
all(NaN);
all(Infinity);
all(999999.995);
all(new Number(5));
all(12345678901234567890n);
report(formatter().format(0.1234));
report(formatter() === formatter());
report(formatter() instanceof Intl.NumberFormat);
report(formatter().resolvedOptions().style);
report(formatter().format(NaN));
report("end");
