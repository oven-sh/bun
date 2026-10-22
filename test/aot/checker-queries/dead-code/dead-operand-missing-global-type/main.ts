declare const live: boolean;
function kept() { if (false) { return (async function* () { yield 1; })(); } return live ? 1 : 2; }
export const answer = false ? (async function* () { yield 2; })() : kept();
