// Another file stores to objects and keys that nobody knows, so each method of the class may have been replaced when it is called. The object is new, and a private method reads its field behind a call of a public one.
import "./replaces-members.js";

class Vault {
  #secret: number;
  constructor(secret: number) {
    this.#secret = secret;
  }
  reveal(): number {
    return this.#secret + 1;
  }
  #double(): number {
    return this.#secret * 2;
  }
  doubled(): number {
    return this.#double();
  }
}

function honest(label: string): void {
  const a = new Vault(4);
  console.log(label, a.reveal(), a.doubled());
}

honest("before");
const hidden = (text: string): any => (0, eval)("(" + text + ")");
(globalThis as any).Vault = Vault;
for (const text of ["{}", "new Vault(1)", "Object.create(Vault.prototype)"]) {
  try {
    console.log(text, Vault.prototype.reveal.call(hidden(text)), Vault.prototype.doubled.call(hidden(text)));
  } catch (error) {
    console.log(text, "threw", (error as Error).constructor.name);
  }
}
Vault.prototype.reveal = function () {
  return -1;
};
honest("after");
