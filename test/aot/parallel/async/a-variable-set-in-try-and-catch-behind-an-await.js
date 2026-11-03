async function readResult(path, parse) {
  const content = await Promise.resolve(path);
  let raw;
  try {
    raw = parse(content);
  } catch {
    raw = undefined;
  }
  return raw;
}
console.log(await readResult("[1]", JSON.parse), await readResult("[", JSON.parse));
