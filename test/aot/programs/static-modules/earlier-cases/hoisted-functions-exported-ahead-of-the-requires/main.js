// `exports.f = f` ahead of the requires of the file, as TypeScript emits it.
const user = require("./user");
console.log(user.declared(), user.viaVar(), user.viaConst(), (0, user.debug)());
