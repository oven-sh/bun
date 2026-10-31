// A `.js` file that names `module` and `exports` only through a `--define` is a CommonJS file, and each defined name reads what the file has under its name.
// Flags: --define M=module --define E=exports --define R=require --define D=__dirname --define A=arguments --define F=__filename
console.log(typeof M, typeof E, typeof R, typeof D, typeof F, typeof A);
