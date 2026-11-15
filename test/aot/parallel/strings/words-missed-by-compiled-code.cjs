// Words that are none of a run-time pattern's are told apart by compiled code, without a match by the engine.
// COUNT: counter:RegExpMatchesInterpreted <= 4000
"use strict";
const keywords = new RegExp("^(?:" + "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false".replace(/ /g, "|") + ")$");
const text = "identifier value index length name type parse token position start end line column options node scope buffer result return if";
const words = text.split(" "), counts = [0, 0];
for (let i = 0; i < 1000; i++) for (const word of words) counts[keywords.test(word) ? 1 : 0]++;
console.log(counts.join());
