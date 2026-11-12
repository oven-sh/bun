export async function imported(name) {
  const loaded = await import("./things/" + name);
  return loaded.default;
}
