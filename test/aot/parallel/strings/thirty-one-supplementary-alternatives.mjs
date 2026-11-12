// Patterns in a unicode mode of 1, 2, 30, 31 and 32 alternatives, each of one or two supplementary code points: they are matched with a bit for each alternative.
const faces = (from) => [...Array(40).keys()].map(index => String.fromCodePoint(0x1f600 + ((from + index) % 80)));
const subjects = [
  "",
  "no face",
  faces(0).join(""),
  faces(20).join("x"),
  "\u{1f600}\u{1f61e}\u{1f61d}\u{1f601}\u{1f61f}\u{1f61e}\u{1f61e}",
  "\ud83d\u{1f61e}\ude1e\u{1f61e}\u{1f600}\ud83d",
  "a\u{1f61e}\u{1f61f}b\u{1f61d}\u{1f61e}\u{1f602}\u{1f603}c".repeat(3),
];
const patterns = [
  /\u{1f61e}\u{1f61f}/gu,
  /\u{1f600}\u{1f601}|\u{1f61e}\u{1f61f}/gu,
  /\u{1f600}\u{1f601}|\u{1f601}\u{1f602}|\u{1f602}\u{1f603}|\u{1f603}\u{1f604}|\u{1f604}\u{1f605}|\u{1f605}\u{1f606}|\u{1f606}\u{1f607}|\u{1f607}\u{1f608}|\u{1f608}\u{1f609}|\u{1f609}\u{1f60a}|\u{1f60a}\u{1f60b}|\u{1f60b}\u{1f60c}|\u{1f60c}\u{1f60d}|\u{1f60d}\u{1f60e}|\u{1f60e}\u{1f60f}|\u{1f60f}\u{1f610}|\u{1f610}\u{1f611}|\u{1f611}\u{1f612}|\u{1f612}\u{1f613}|\u{1f613}\u{1f614}|\u{1f614}\u{1f615}|\u{1f615}\u{1f616}|\u{1f616}\u{1f617}|\u{1f617}\u{1f618}|\u{1f618}\u{1f619}|\u{1f619}\u{1f61a}|\u{1f61a}\u{1f61b}|\u{1f61b}\u{1f61c}|\u{1f61c}\u{1f61d}|\u{1f61d}\u{1f61e}/gu,
  /\u{1f600}\u{1f601}|\u{1f601}\u{1f602}|\u{1f602}\u{1f603}|\u{1f603}\u{1f604}|\u{1f604}\u{1f605}|\u{1f605}\u{1f606}|\u{1f606}\u{1f607}|\u{1f607}\u{1f608}|\u{1f608}\u{1f609}|\u{1f609}\u{1f60a}|\u{1f60a}\u{1f60b}|\u{1f60b}\u{1f60c}|\u{1f60c}\u{1f60d}|\u{1f60d}\u{1f60e}|\u{1f60e}\u{1f60f}|\u{1f60f}\u{1f610}|\u{1f610}\u{1f611}|\u{1f611}\u{1f612}|\u{1f612}\u{1f613}|\u{1f613}\u{1f614}|\u{1f614}\u{1f615}|\u{1f615}\u{1f616}|\u{1f616}\u{1f617}|\u{1f617}\u{1f618}|\u{1f618}\u{1f619}|\u{1f619}\u{1f61a}|\u{1f61a}\u{1f61b}|\u{1f61b}\u{1f61c}|\u{1f61c}\u{1f61d}|\u{1f61d}\u{1f61e}|\u{1f61e}\u{1f61f}/gu,
  /\u{1f600}\u{1f601}|\u{1f601}\u{1f602}|\u{1f602}\u{1f603}|\u{1f603}\u{1f604}|\u{1f604}\u{1f605}|\u{1f605}\u{1f606}|\u{1f606}\u{1f607}|\u{1f607}\u{1f608}|\u{1f608}\u{1f609}|\u{1f609}\u{1f60a}|\u{1f60a}\u{1f60b}|\u{1f60b}\u{1f60c}|\u{1f60c}\u{1f60d}|\u{1f60d}\u{1f60e}|\u{1f60e}\u{1f60f}|\u{1f60f}\u{1f610}|\u{1f610}\u{1f611}|\u{1f611}\u{1f612}|\u{1f612}\u{1f613}|\u{1f613}\u{1f614}|\u{1f614}\u{1f615}|\u{1f615}\u{1f616}|\u{1f616}\u{1f617}|\u{1f617}\u{1f618}|\u{1f618}\u{1f619}|\u{1f619}\u{1f61a}|\u{1f61a}\u{1f61b}|\u{1f61b}\u{1f61c}|\u{1f61c}\u{1f61d}|\u{1f61d}\u{1f61e}|\u{1f61e}\u{1f61f}|\u{1f61f}\u{1f600}/gu,
  /(\u{1f61e})(\u{1f61f})|(\u{1f600})(\u{1f601})/u,
];
for (const pattern of patterns) {
  for (const subject of subjects) {
    const out = [];
    pattern.lastIndex = 0;
    for (let match, turns = 0; (match = pattern.exec(subject)) !== null && turns < 60; turns++) {
      out.push(match.index, ...[...match].map(part => (part === undefined ? "-" : [...part].map(point => point.codePointAt(0).toString(16)).join("+"))));
      if (!pattern.global) break;
    }
    console.log(subject.length, out.join(" "), pattern.test(subject), subject.search(pattern));
  }
}
