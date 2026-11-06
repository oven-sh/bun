export const top = this === undefined ? "undefined" : this === null ? "null" : this === globalThis ? "the global object" : typeof this;
export const inAnArrow = (() => this === undefined ? "undefined" : this === null ? "null" : this === globalThis ? "the global object" : typeof this)();
