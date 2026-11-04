"use strict";
require("./child.cjs");
Object.defineProperty(module, "exports", { get() { return { same: this === module, id: typeof this.id, children: this.children.map((it) => JSON.stringify(it.exports)).join(), parent: typeof this.parent, above: this.parent && Object.keys(this.parent.exports).join() }; } });
