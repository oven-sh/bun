// Each row is a pattern whose text the build cannot know, and a text. ../patterns-made-at-run-time-step-by-step.test.ts holds one row against another.
const made = text => text + String(Date.now()).slice(99);
const manySteps = "^[^,;](?:[^,;][,;]){100}$";
const words = "break|case|catch|continue|debugger|default|do|else|finally|for|function|if|return|switch|throw|try|var|while|with|null|true|false|instanceof|typeof|void|delete|new|in|this";
const rows = {
  "a-run-behind-a-letter": ["x[a-z]*", "", "xabcdef1"],
  "a-digit-behind-a-run-behind-a-letter": ["x[a-z]*[0-9]", "", "xabcdef1"],
  "three-runs-in-groups": ["<([^a-z<>/]*)/([^a-z<>]*)e([\\u200b\\u2060]*)n", "iu", "<一/en>"],
  "three-runs-in-lookaheads-read-again": ["<(?=([^a-z<>/]*))\\1/(?=([^a-z<>]*))(?:\\2)e(?=([\\u200b\\u2060]*))\\3n", "iu", "<一/en>"],
  "many-steps-behind-a-wide-character": [manySteps, "u", "一" + "a,b;".repeat(50)],
  "many-steps-behind-a-surrogate-pair": [manySteps, "u", "\u{1d236}" + "a,b;".repeat(50)],
  "one-word": ["^typeof$", "", "typeof"],
  "one-word-of-a-list-of-words": [`^(?:${words})$`, "", "typeof"],
  "one-wide-word-of-a-list-of-words": [`^(?:${words}|一)$`, "", "一typeof".slice(1)],
};
const name = process.argv[2];
if (name) {
  const [source, flags, text] = rows[name];
  const pattern = new RegExp(made(source), flags);
  const subject = made(text);
  const turns = Number(process.argv[3]);
  let found = 0;
  for (let i = 0; i < turns; i++) if (pattern.test(subject)) found++;
  console.log(name, found === turns);
} else {
  for (const [name, [source, flags, text]] of Object.entries(rows)) console.log(name, JSON.stringify(new RegExp(made(source), flags).exec(made(text))));
}
