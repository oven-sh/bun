export let total = 1;
export function storeByEval(text) { eval(text); }
export const readByEval = text => eval(text);
