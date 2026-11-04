// Intl.Segmenter.
// Flags: --explain=trim
// Build prints: 0 x aot: trim: locales: none
console.log([...new Intl.Segmenter((process.argv[2] ?? "ja-JP"), { granularity: "word" }).segment("今日は晴れです")].length);
