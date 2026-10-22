for (const part of new Intl.Segmenter("en-US", { granularity: "word" }).segment("a b")) console.log(part.segment.length, part.index + 1, part.isWordLike);
