// Native code rejects the promise of a read of a file that is not there, and the handler that catch() or then() was given gets the error, as a `catch` around an await does.
import { tmpdir } from "node:os";
import { join } from "node:path";

const missing = Bun.file(join(tmpdir(), `no-such-file-${process.pid}`, "a.txt"));
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code;

console.log(await missing.text().catch(codeOf));
console.log(await missing.bytes().catch(codeOf));
console.log(await missing.arrayBuffer().catch(codeOf));
console.log(await missing.json().catch(codeOf));
console.log(await missing.slice(1, 2).text().catch(codeOf));
console.log(await missing.text().then(() => "read", codeOf));
console.log(await missing.delete().catch(codeOf));
console.log(await missing.exists().catch(codeOf));
try {
  await missing.text();
} catch (error) {
  console.log(codeOf(error), error instanceof Error);
}
let seen = "";
await missing.text().catch(error => {
  seen = `${error.code} ${error.syscall} ${typeof error.errno} ${error.path === missing.name}`;
});
console.log(seen);
