// Receivers below an accessor: a proxy without traps forwards a read to its target with the proxy as the receiver, so accessors and methods of the class run with a `this` that has no private field and is no instance layout.
let total = 0;

class Vault {
  #secret = 5;
  open = 7;
  get secret(): number {
    return this.#secret;
  }
  get visible(): number {
    total += 1;
    return this.open + 1;
  }
  has(): boolean {
    return #secret in this;
  }
}

const vault = new Vault();
const proxy = new Proxy(vault, {});
const results: unknown[] = [vault.secret, vault.visible, proxy.visible, proxy instanceof Vault, proxy.has(), vault.has(), JSON.stringify(proxy), Object.keys(proxy).join()];
try {
  results.push(proxy.secret);
} catch (error) {
  results.push((error as Error).name);
}
const revocable = Proxy.revocable(vault, {});
revocable.revoke();
try {
  results.push(revocable.proxy.visible);
} catch (error) {
  results.push((error as Error).name);
}
console.log(total, results.join());
