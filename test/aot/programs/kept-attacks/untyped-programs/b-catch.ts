// Untyped programs: b catch. It prints what plain Bun prints.
try {
  (null as any).x;
} catch (e) {
  console.log(1);
}
