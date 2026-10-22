// Native code rejects the promise of a Blob's json() where the text is no JSON, and the handler that catch() or then() was given gets the error.
const nameOf = (error: unknown) => (error as Error).name;

console.log(await new Blob(["{"]).json().catch(error => error.name));
console.log(await new Blob(["{"]).json().catch(nameOf));
console.log(await new Blob(["{"]).json().then(() => "parsed", error => error.name));
console.log(JSON.stringify(await new Blob(['{"a":1}']).json().catch(nameOf)));
try {
  await new Blob(["{"]).json();
} catch (error) {
  console.log(nameOf(error), error instanceof SyntaxError);
}
