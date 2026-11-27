exports.byRequire = parts => {
  const name = parts.join("/");
  try {
    const found = require(name);
    return `require ${name}: ${Object.keys(found).sort()} ${(found.other ?? found.default ?? found.unread)?.("x")}`;
  } catch (error) {
    return `require ${name}: ${error.code}`;
  }
};
