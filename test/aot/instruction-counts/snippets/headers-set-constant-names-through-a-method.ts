// sets three headers by constant names through a method that takes the name
const operations = 20;
class Context {
  #response: Response | undefined;
  #prepared: Headers | undefined;
  finalized = false;
  set response(response: Response) {
    this.#response = response;
    this.finalized = true;
  }
  header(name: string, value: string | undefined, options?: { append?: boolean }): void {
    if (this.finalized) this.#response = new Response((this.#response as Response).body, this.#response);
    const headers = this.#response ? this.#response.headers : (this.#prepared ??= new Headers());
    if (value === undefined) headers.delete(name);
    else if (options?.append) headers.append(name, value);
    else headers.set(name, value);
  }
}
const values = ["one", "two", "three", "four"];
const contexts = [new Context(), new Context(), new Context(), new Context()];
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const context = contexts[i & 3];
    context.response = new Response(null);
    context.finalized = false;
    context.header("x-request-id", values[i & 3]);
    context.header("x-content-type-options", "nosniff");
    context.header("cache-control", "no-store");
    sum += i;
  }
}

console.log(sum);
