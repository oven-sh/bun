const filledPath = require.resolve("./filled.cjs");
const definedPath = require.resolve("./defined.cjs");
const loaded = [];

function loadFilled(label) {
  delete require.cache[filledPath];
  const fresh = require("./filled.cjs");
  fresh.label = label;
  loaded.push(fresh);
  return fresh;
}

function loadDefined(label) {
  delete require.cache[definedPath];
  const fresh = require("./defined.cjs");
  fresh.label = label;
  loaded.push(fresh);
  return fresh;
}

function changeFilledQuietly(object) {
  object.first = "stored quietly";
  object.added = "added quietly";
  return [object.first, object.added, delete object.third, delete object.absent];
}

function changeDefinedQuietly(object) {
  object.__esModule = "stored quietly";
  object.live = "stored quietly";
  object.fixed = "stored quietly";
  return [object.__esModule, object.fixed, delete object.__esModule, delete object.live, delete object.fixed];
}

module.exports = { loadFilled, loadDefined, loaded, changeFilledQuietly, changeDefinedQuietly };
