// In an ES module a `--define` whose value is `module`, `exports` or `arguments` finds no variable of that name, and `require`, `__dirname` and `__filename` are what the module has.
// Flags: --define M=module --define E=exports --define R=require --define D=__dirname --define A=arguments --define F=__filename
console.log(typeof M, typeof E, typeof R, typeof D, typeof F, typeof A);
export {};
