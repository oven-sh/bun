// answers: without-library
// # `var count = 0; function push(x) { items[count] = x; count++; }`: a stack's counter, captured by closures: undefined before its initializer has run, then a number: it is kept as an optional double.
// # As the key of a list it is taken as it lies: made an index, the index made a number again and compared: what is no index leaves for the late path: undefined (the markers of an optional double are NaNs), NaN,
// # fractions, negative numbers, infinities, numbers past the greatest index. No value is boxed for the key.
// # f4 = push
// # RUN(FORM): walk f4 mechanisms=all
// # FORM-LABEL: code f4:Body
// # FORM-NOT: @JSValue = Box
// # FORM: = PutArrayElement
// # f6 = peek
// # RUN(READ): walk f6 mechanisms=all
// # READ-LABEL: code f6:Body
// # READ-NOT: @JSValue = Box
// # READ: = GetArrayElement
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 19 of 19 of 19
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const early: string[] = [];
function make() { var items: unknown[] = []; early.push(String(peek())); push("before the counter has a value"); early.push(String((items as unknown as Record<string, unknown>)["undefined"]) + " " + String(items.length) + " " + String(peek())); var count = 0; function push(x: unknown): void { items[count] = x; count++; } function pop(): unknown { count--; const x = items[count]; items[count] = undefined; return x; } function peek(): unknown { return items[count]; } function setTo(n: number): void { count = n; } function size(): string { return String(count) + "/" + String(items.length); } return { push, pop, peek, setTo, size }; }
const stack = make();
report(early[0] + " | " + early[1]);
stack.push("a"); stack.push("b"); stack.push("c");
report(String(stack.pop()) + String(stack.pop()) + " " + stack.size() + " " + String(stack.peek()));
function at(n: number): string { stack.setTo(n); stack.push("at " + String(n)); const after = stack.size(); stack.setTo(n); return String(stack.peek()) + " " + after; }
report(at(0.5) + " | " + at(-1) + " | " + at(-0) + " | " + at(NaN));
report(at(Infinity) + " | " + at(-Infinity) + " | " + at(4294967294) + " | " + at(4294967295));
report(at(4294967296) + " | " + at(4294967297) + " | " + at(9007199254740992) + " | " + at(1e21) + " | " + at(2147483648));
report(at(5) + " | " + at(2) + " | " + at(1.0000000000000002));
stack.setTo(1); report(String(stack.pop()) + " " + String(stack.pop()) + " " + stack.size());
function makeMarked() { var list: unknown[] = ["zero", "one"]; var numbers: number[] = [10, 11, 12]; var mark = null; function read(): unknown { return list[mark]; } function write(x: unknown): void { list[mark] = x; } function setMark(n: number): void { mark = n; } function clearMark(): void { mark = null; } function guarded(): unknown { const n = mark; return n >= 0 && n < list.length ? list[n] : "outside"; } function whole(): number { const n = mark; return typeof n === "number" && (n | 0) === n && n >= 0 ? numbers[n] + 0.5 : -1; } return { read, write, setMark, clearMark, guarded, whole, list }; }
const marked = makeMarked();
report("under null, guarded: " + String(marked.guarded()) + " whole: " + String(marked.whole()));
report(String(marked.read()) + " " + (marked.write("under null"), String(marked.read())) + " " + String((marked.list as unknown as Record<string, unknown>)["null"]) + " " + String(marked.list.length));
marked.setMark(1); report(String(marked.read()) + " " + (marked.write("uno"), String(marked.read())));
marked.setMark(1.5); report(String(marked.read()) + " " + (marked.write("between"), String(marked.read())) + " " + String(marked.list.length));
report("at 1.5, guarded: " + String(marked.guarded()) + " whole: " + String(marked.whole()));
marked.setMark(1); report("at 1, guarded: " + String(marked.guarded()) + " whole: " + String(marked.whole()));
marked.setMark(2); report("at 2, guarded: " + String(marked.guarded()) + " whole: " + String(marked.whole()));
marked.setMark(-0); report("at -0, guarded: " + String(marked.guarded()) + " whole: " + String(marked.whole()));
marked.setMark(NaN); report("at NaN, guarded: " + String(marked.guarded()) + " whole: " + String(marked.whole()));
marked.setMark(4294967297); report("past the greatest index, guarded: " + String(marked.guarded()) + " whole: " + String(marked.whole()));
marked.clearMark(); report(String(marked.read()) + " guarded: " + String(marked.guarded()));
report("end");
