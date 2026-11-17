export class B extends K {
  constructor(...args) {
    super();
    if (globalThis.never) this.args = args;
  }
  m() {
    return 1;
  }
}
export const K = class {};
