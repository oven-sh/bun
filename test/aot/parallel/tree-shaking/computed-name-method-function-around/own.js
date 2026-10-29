// Here `this` belongs to the member: the function around it looks at nothing.
export function ownThisOfAMethod() { return { method() { return this === undefined; } }; }
export function neverNamed() { return "never named"; }
