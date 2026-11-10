function withoutBlanksAtTheEnd(text) {
  let end = text.length;
  while (end > 0 && text[end - 1] === " ") {
    end--;
  }
  return text.slice(0, end) + "|" + end;
}
console.log(withoutBlanksAtTheEnd(JSON.parse('"tide   "')), withoutBlanksAtTheEnd(JSON.parse('"   "')));
