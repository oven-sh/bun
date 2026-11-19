"use strict";
module.exports = function ask(name) {
  try {
    var found = eval("quire".replace(/^/, "re"))(name);
    if (found && (found.length || Object.keys(found).length)) return found;
  } catch (error) {}
  return null;
};
