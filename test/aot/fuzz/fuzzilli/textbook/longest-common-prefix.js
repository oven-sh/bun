function commonStart(words) {
  let kept = words[0];
  for (let i = 1; i < words.length; i++) {
    let same = 0;
    while (same < kept.length && same < words[i].length && kept[same] === words[i][same]) same++;
    kept = kept.slice(0, same);
  }
  return kept;
}
console.log(commonStart(JSON.parse('["flower","flow","flight"]')));
