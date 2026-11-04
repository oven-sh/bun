export function listed(bytes) {
  const seen = [];
  for (const byte of bytes.values()) seen.push(byte);
  return seen.join();
}
