function scan(text: string) {
  let pos = 0, end = text.length, seen = 0;
  const marks: number[] = [];
  let startOfBody: any = undefined;
  for (let i = 0; i < text.length; i++) if (text[i] === "/") { startOfBody = startOfBody === undefined ? i : startOfBody; marks.push(i); }
  range(startOfBody, marks[marks.length - 1] - startOfBody, () => { seen += end - pos; });
  range(0, 2.5, () => { seen += end; });
  return seen;
  function range(start: number, length: number, callback: () => void) {
    const saveEnd = end, savePos = pos;
    pos = start; end = start + length;
    callback();
    end = saveEnd; pos = savePos;
  }
}
console.log(scan("a/bc/d"), scan("//"));
