// String() of what the shell is made of prints a function of native code, also of a class, an async function and a generator.
const { ShellPromise, ShellError, Shell } = Bun.$;
const shown = { Shell, ShellPromise, ShellError, braces: Bun.$.braces, then: ShellPromise.prototype.then, text: ShellPromise.prototype.text, lines: ShellPromise.prototype.lines, cwd: ShellPromise.prototype.cwd };
for (const [name, value] of Object.entries(shown)) console.log(name, String(value));
