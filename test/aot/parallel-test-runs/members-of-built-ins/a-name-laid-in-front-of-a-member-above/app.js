export function filled(bytes, from) {
  bytes.set(from);
  return bytes.join();
}
