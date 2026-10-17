// sets a header of a Response or of prepared Headers by a name that is a parameter
const operations = 20;
const names = ["cache-control", "x-request-id", "x-content-type-options", "vary"];
const state: { response: Response | undefined; prepared: Headers | undefined } = { response: undefined, prepared: undefined };
function header(name: string, value: string | undefined): void {
  const headers = state.response ? state.response.headers : (state.prepared ??= new Headers());
  if (value === undefined) headers.delete(name);
  else headers.set(name, value);
}
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    state.response = new Response(null);
    header(names[i & 3], "value");
    sum += state.response.status;
  }
}

console.log(sum);
