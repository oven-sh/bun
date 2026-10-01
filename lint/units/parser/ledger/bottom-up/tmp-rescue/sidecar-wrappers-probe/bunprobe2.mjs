const inputs = ["class A { accessor x = 1 }", "class A { static accessor x = 1 }", "class A { @dec accessor x = 1 }", "class A { @a! x; @b.c! y }", "@(a) class X {}", "@a! class Y {}"];
for (const exp of [true, false]) for (const src of inputs) {
  let out;
  try { out = "OK  " + JSON.stringify(new Bun.Transpiler({ loader: "ts", tsconfig: { compilerOptions: { experimentalDecorators: exp } } }).transformSync(src).trim().slice(0, 80)); }
  catch (e) { out = "ERR " + (e.errors ?? [e]).map(x => x.message).join(" | "); }
  console.log(String(exp).padEnd(6) + JSON.stringify(src).padEnd(40) + out);
}
