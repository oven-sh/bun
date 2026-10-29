export function hash(text) {
  let result = 0;
  for (let i = 0; i < text.length; i++) result = (result * 31 + text.charCodeAt(i)) | 0;
  return result;
}

export function initials(text) {
  return text
    .split(" ")
    .map(word => word[0])
    .join("");
}

export function quoted(text) {
  return '"' + text + '"';
}

export function isBeforeM(text) {
  return text < "m";
}

export function lookUp(table, key) {
  return table[key];
}

export default function shorten(text) {
  return text.length > 5 ? text.slice(0, 5) + "..." : text;
}
