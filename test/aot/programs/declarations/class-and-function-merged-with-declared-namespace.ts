// A class or a function merged with a `declare namespace` that declares values: statics, `prototype` and added properties are ordinary properties.
class Completions {
  name = "completions";
}
class Client {
  static DEFAULT_TIMEOUT = 600;
  timeout: number = Client.DEFAULT_TIMEOUT;
  send(): string {
    return "sent";
  }
  isOverridden(): boolean {
    return this.send !== Client.prototype.send;
  }
}
Client.Completions = Completions;
declare namespace Client {
  export { Completions as Completions };
}
class Patched extends Client {
  send(): string {
    return "patched";
  }
}
function marked(text: string): string {
  return text.toUpperCase();
}
declare namespace marked {
  let once: typeof marked;
}
marked.once = marked;
marked.twice = (text: string) => marked(text) + marked.once(text);
console.log(new Client().timeout, new Client.Completions().name, new Client().isOverridden(), new Patched().isOverridden());
console.log(marked.once("a"), marked.twice("b"), Object.keys(marked).join());
Client.DEFAULT_TIMEOUT = 5;
console.log(new Client().timeout, Object.keys(Client).join());
export {};
