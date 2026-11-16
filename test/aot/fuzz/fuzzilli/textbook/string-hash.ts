function hashed(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash;
}
console.log(hashed("harbor"), hashed(JSON.parse('"a longer text that overflows thirty-two bits"')), hashed(""));
