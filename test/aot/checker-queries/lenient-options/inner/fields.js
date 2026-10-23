// What TypeScript emits for `root: Node;` is `root;`. The constructor says what the field holds, as it does for a field that is not declared.
class Node { value = 0; }
export class Declared { root; #count; constructor() { this.root = new Node(); this.#count = 1; } count() { return this.#count; } }
export class Stored { constructor() { this.root = new Node(); } }
