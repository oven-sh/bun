/** Runs ./<file>.test.ts, which skips itself unless the environment variable `name` is set, as a test file of its own. */
export async function testOptIn(name: string, value: string, file: string) {
  process.env[name] = value;
  await import(`./${file}.test.ts`);
}
