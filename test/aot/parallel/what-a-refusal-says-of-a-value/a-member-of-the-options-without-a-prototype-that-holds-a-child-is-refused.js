// The message of the refusal says what kind of value it was and looks at nothing that the object holds.
const child = Bun.spawn(["true"]);
try {
  Bun.spawn(["true"], { signal: { __proto__: null, child } });
} catch (error) {
  console.log(error.code, error.message);
}
