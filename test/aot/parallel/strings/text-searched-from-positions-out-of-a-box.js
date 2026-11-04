// texts and positions that the build has not seen: integers inside, at and beyond both ends, fractions, texts, null: indexOf, lastIndexOf and startsWith take each as the language says
// COUNT: operation:operationAOTStringIndexOfFrom >= 200
const box = JSON.parse('{"texts":["abcabc","","k\\u016f\\u0148 k\\u016f\\u0148","c"],"parts":["c","","bc","\\u016f","abcabcabc"],"positions":[0,1,3,5,6,7,100,-1,-100,2147483647,-2147483648,2.9,-0.5,1e400,"3","x",null,true,4294967299]}');
function found(text, part, from) {
  const place = text.indexOf(part, from);
  return String(place);
}
function foundLast(text, part, from) {
  const place = text.lastIndexOf(part, from);
  return String(place);
}
function began(text, part, from) {
  const answer = text.startsWith(part, from);
  return answer ? "y" : "n";
}
function deed(search) {
  const lines = [];
  for (let t = 0; t < box.texts.length; t++) {
    for (let p = 0; p < box.parts.length; p++) {
      let line = "";
      for (let i = 0; i < box.positions.length; i++) line += search(box.texts[t], box.parts[p], box.positions[i]) + " ";
      lines.push(line);
    }
  }
  return lines.join("\n");
}
console.log(deed(found));
console.log(deed(foundLast));
console.log(deed(began));
