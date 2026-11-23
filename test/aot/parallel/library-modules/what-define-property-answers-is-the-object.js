// Object.defineProperty answers its first operand: where the answer is kept, `process` has gone out of sight.
const same = Object.defineProperty(process, "markOfThisProgram", { value: 1, configurable: true });
const list = [same];
list[0].stdout.write("written through what defineProperty answered " + process.markOfThisProgram + "\n");
