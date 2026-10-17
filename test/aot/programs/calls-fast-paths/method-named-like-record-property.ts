// A store into a record whose optional properties are named like a class's methods does not make calls of those methods go by name: no instance of the class flows into the record's type.
// IR= 0 read CallMethod
type Targets = { json: object; query: object; header: object };

class IncomingRequest {
  #validated: { [Key in keyof Targets]?: {} } | undefined;
  #headers: Map<string, string>;
  constructor(headers: Map<string, string>) {
    this.#headers = headers;
  }
  addValidated(target: keyof Targets, data: {}): void {
    (this.#validated ??= {})[target] = data;
  }
  validated(target: keyof Targets): {} | undefined {
    return this.#validated?.[target];
  }
  header(name: string): string | undefined {
    return this.#headers.get(name);
  }
  query(name: string): string {
    return "query " + name;
  }
  json(): string {
    return "{}";
  }
}

function read(request: IncomingRequest): string {
  return request.header("a") + " " + request.query("b") + " " + request.json();
}

const request = new IncomingRequest(new Map([["a", "1"]]));
request.addValidated("header", { a: 1 });
console.log(read(request), JSON.stringify(request.validated("header")), request.validated("json"));
