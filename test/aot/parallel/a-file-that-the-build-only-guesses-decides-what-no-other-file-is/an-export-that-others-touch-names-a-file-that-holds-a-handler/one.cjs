let found = "one";
try {
  found = JSON.parse('"one parsed"');
} catch {}
module.exports = found;
