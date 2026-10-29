// Native code rejects the promise of a lookup of a host that does not exist, and the handler that catch() or then() was given gets the error.
const codeOf = (error: unknown) => typeof (error as NodeJS.ErrnoException).code;

console.log(await Bun.dns.lookup("no-such-host.invalid").catch(codeOf));
console.log(await Bun.dns.lookup("no-such-host.invalid").then(() => "found", codeOf));
try {
  await Bun.dns.lookup("no-such-host.invalid");
} catch (error) {
  console.log(codeOf(error), error instanceof Error);
}
console.log(await Bun.sleep(1).then(() => "slept", codeOf));
