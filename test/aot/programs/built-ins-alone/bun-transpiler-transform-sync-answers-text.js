const transpiler = new Bun.Transpiler({ loader: "ts" });
console.log(typeof transpiler.transformSync("const size: number = 1;"), transpiler.scanImports("import \"a\";").length);
