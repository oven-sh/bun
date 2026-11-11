// THE CONTROL: quiet under `bun run`, and here.
const { signal } = new AbortController();
const { removeEventListener } = signal;
function heard() {}
console.log(removeEventListener("abort", heard));
