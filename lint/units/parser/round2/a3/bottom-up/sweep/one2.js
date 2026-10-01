const [loader, deco, ...rest] = process.argv.slice(2);
const src = rest.join(" ");
const tsconfig = deco === "deco" ? JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }) : undefined;
try { console.log(JSON.stringify(new Bun.Transpiler({ loader, tsconfig }).transformSync(src))); } catch (e) { console.log("ERR", (e.errors ?? [e]).map(x => x.message)); }
