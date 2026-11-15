module.exports = from => {
  const { cache } = from.constructor._cache ? { cache: from.constructor._cache } : require;
  for (const key of Object.keys(cache)) if (key.endsWith("part.cjs")) delete cache[key];
};
