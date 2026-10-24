const Nothing = null as unknown as new () => object;
function define(): new () => object { return class extends Nothing {}; }
const Heir = define();
export const made = new Heir();
