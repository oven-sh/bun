import { readFileSync } from "fs";

var memoizeMap;

// This gives us a package version inline into the build without pulling in the whole package.json
// it only parses the package.json for a given package name once (relative to the directory of this file)
export function packageVersion(call) {
  var name = call.arguments[0].toString();

  // in the general case, this would break when using multiple versions of the same package
  // but people don't use multiple versions of next in the same bundle
  // so we don't need to worry about it here
  // and it skips resolveSync which is a bit faster
  if (memoizeMap) {
    const value = memoizeMap.get(name);
    if (value) return value;
  }
  var nextPath;
  try {
    nextPath = Bun.resolveSync(`${name}/package.json`, import.meta.dir);
  } catch (exception) {
    throw new Error(`${name} is not a valid package name`);
  }

  var json;
  try {
    // TODO: Add sync methods to FileBlob?
    json = JSON.parse(readFileSync(nextPath, "utf8"));
  } catch (exc) {
    throw new AggregateError([exc], `Error parsing ${name}/package.json`);
  }

  if (!json.version) {
    throw new Error(`${name}/package.json is missing a version`);
  }

  if (!memoizeMap) {
    memoizeMap = new Map();
  }

  memoizeMap.set(name, json.version);

  return json.version;
}
