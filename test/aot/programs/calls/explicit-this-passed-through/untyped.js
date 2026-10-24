export function sloppy() { return typeof this + " " + (this === globalThis) + " " + (this instanceof Number); }
export function strict() { "use strict"; return typeof this + " " + String(this); }
