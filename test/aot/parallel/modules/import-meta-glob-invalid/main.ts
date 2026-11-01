// Build prints: 1 x warn: Expected a glob pattern to be a string literal, but got identifier
// Build prints: 1 x warn: Expected the "import.meta.glob" option "eager" to be a boolean literal, but got binary
// Build prints: 1 x warn: Expected a glob pattern to start with "/", "./", "../", "**" or a path alias, but got "pages/*.ts"
// Build prints: 1 x warn: "import.meta.glob" expects 1 or 2 arguments, but got 0
const pattern = "./pages/" + process.argv.length + ".ts";
let evaluated = 0;
for (const ask of [
  () => import.meta.glob(pattern),
  () => import.meta.glob("./pages/*.ts", { eager: (evaluated++, 1) as any }),
  () => import.meta.glob("pages/*.ts"),
  () => (import.meta.glob as any)(),
  () => import.meta.glob("./pages/*.ts"),
])
  try {
    console.log(Object.keys(ask()).join());
  } catch (error: any) {
    console.log(error.constructor.name + ": " + error.message);
  }
console.log(evaluated);
