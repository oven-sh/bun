import * as unit from "./unit.cjs";
export { unit };
const note = text => (globalThis.order ??= []).push(text);
note("between");
