// An ES module answers `require` with its namespace object unless it exports the name "module.exports", or has names that show at run time. Only the loader of the run time answers for those,
// whether a site spells the file or a pattern finds it.
// RUN(PATTERN): link
// PATTERN: module [[plain]] path="{{*}}/pages/plain.mjs"
// PATTERN: module [[starred]] path="{{*}}/pages/starred.mjs"
// PATTERN: module [[value]] path="{{*}}/pages/value.mjs"
// PATTERN: EvaluateModule module=[[plain]]
// PATTERN: RequireModule module=[[starred]]
// PATTERN: RequireModule module=[[value]]

// FILE: main.cjs
exports.pick = name => require(`./pages/${name}.mjs`);

// FILE: pages/plain.mjs
export const a = 1;

// FILE: pages/starred.mjs
export * from "../shelf.cjs";

// FILE: pages/value.mjs
function value() {}
export { value as "module.exports" };

// FILE: shelf.cjs
exports.a = 1;
