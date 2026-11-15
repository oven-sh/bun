// One question: built alone, it prints as plain Bun does.
const url = new URL("http://made.up/a"); let text = "no refusal"; try { new CompressionStream(url); } catch (error) { text = `${error}`; } console.log(text.includes("href"));
