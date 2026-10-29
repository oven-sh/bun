export const ignored = "not visible through require";
const replacement = { name: "the module.exports export" };
export { replacement as "module.exports" };
