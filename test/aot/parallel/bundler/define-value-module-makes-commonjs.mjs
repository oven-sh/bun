// An `.mjs` file without `import` and `export` that names `module` and `exports` is run as a CommonJS file, also where it names them only through a `--define`.
// Flags: --define M=module --define E=exports --define A=arguments --define R=require --define D=__dirname
console.log(typeof M, typeof E, typeof R, typeof D);
